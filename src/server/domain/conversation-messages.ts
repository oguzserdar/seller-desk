import {
  conversationText,
  sellerReplyOf,
  type BuyerReplyState,
} from "@/lib/conversation-messages";
import { loadMessages } from "@/server/ai/conversation";
import { getDb, transaction, type Tx } from "@/server/db/client";
import {
  conversation,
  message,
  seller,
  sellerQuestion,
} from "@/server/db/schema";
import type { StoredMessagePart } from "@/server/db/types";
import { getStorage } from "@/server/storage";
import type { UIMessage } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import {
  ownerConversation,
  type ConversationControl,
} from "./conversation-control";
import { conflict, DomainError, notFound } from "./errors";
import type {
  AssistantTurn,
  BuyerPrincipal,
  OwnerPrincipal,
} from "./principal";

/** Only plain customer text can enter from the buyer API. */
export const BuyerMessage = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();
/** Server-validated direct reply; a pending question is resolved only by explicit revisioned selection. */
export const SellerMessage = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    text: z.string().trim().min(1).max(4000),
    answerPending: z
      .object({ id: z.uuid(), revision: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict();

function toControl(row: typeof conversation.$inferSelect): ConversationControl {
  return { id: row.id, handler: row.handler, revision: row.controlRevision };
}

async function insertOnce(
  tx: Tx,
  conversationId: string,
  row: UIMessage,
): Promise<boolean> {
  const [inserted] = await tx
    .insert(message)
    .values({
      id: row.id,
      conversationId,
      role: row.role as "user" | "assistant",
      parts: row.parts as unknown as StoredMessagePart[],
    })
    .onConflictDoNothing()
    .returning({ id: message.id });
  if (inserted) {
    await tx
      .update(conversation)
      .set({ updatedAt: new Date() })
      .where(eq(conversation.id, conversationId));
    return true;
  }
  const [existing] = await tx
    .select()
    .from(message)
    .where(
      and(
        eq(message.id, row.id),
        eq(message.conversationId, conversationId),
        eq(message.role, row.role as "user" | "assistant"),
      ),
    );
  if (
    !existing ||
    conversationText({
      ...existing,
      parts: existing.parts as UIMessage["parts"],
    }) !== conversationText(row) ||
    Boolean(
      sellerReplyOf({
        ...existing,
        parts: existing.parts as UIMessage["parts"],
      }),
    ) !== Boolean(sellerReplyOf(row))
  )
    throw conflict(
      "That message id is already in use. Reload the conversation before retrying.",
    );
  return false;
}

/** Saves buyer input and chooses human delivery or one AI claim under the same lock. */
export async function receiveBuyerMessage(
  buyer: BuyerPrincipal,
  id: string,
  raw: z.input<typeof BuyerMessage>,
  assistantReady: boolean,
): Promise<{ control: ConversationControl; claim: AssistantTurn | null }> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.receiveBuyerMessage(
      buyer,
      id,
      raw,
      assistantReady,
    );

  const input = BuyerMessage.parse(raw);
  return transaction(getDb(), async (tx) => {
    const [row] = await tx
      .select()
      .from(conversation)
      .where(
        and(
          eq(conversation.id, id),
          eq(conversation.sellerId, buyer.sellerId),
          eq(conversation.buyerSessionId, buyer.buyerSessionId),
        ),
      )
      .for("update");
    if (!row) throw notFound("conversation");
    let claim: AssistantTurn | null = null;
    if (row.handler === "assistant") {
      if (!assistantReady)
        throw new DomainError(
          "unavailable",
          "The shop assistant is not connected right now. You can still browse and add items to your quote.",
          ["browse"],
        );
      if (
        row.activeTurnId &&
        row.activeTurnExpiresAt &&
        row.activeTurnExpiresAt > new Date()
      )
        throw conflict(
          "The assistant is still answering this conversation. Wait for it to finish.",
        );
    }
    const inserted = await insertOnce(tx, id, {
      id: input.id,
      role: "user",
      parts: [{ type: "text", text: input.text }],
    });
    if (row.handler === "assistant") {
      if (!inserted) {
        const history = await loadMessages(id, tx);
        if (history.findLast((item) => item.role === "user")?.id !== input.id)
          throw conflict(
            "A newer message is already saved. Continue from the latest message.",
          );
        if (history.at(-1)?.role !== "user")
          return { control: toControl(row), claim: null };
      }
      claim = { conversationId: id, id: crypto.randomUUID() };
      await tx
        .update(conversation)
        .set({
          activeTurnId: claim.id,
          activeTurnExpiresAt: sql`now() + interval '2 minutes'`,
        })
        .where(eq(conversation.id, id));
    }
    return { control: toControl(row), claim };
  });
}

/** Snapshot history and ownership together, so a stale stream cannot overwrite a human reply. */
export async function readBuyerConversation(buyer: BuyerPrincipal, id: string) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.readBuyerConversation(buyer, id);

  return transaction(getDb(), async (tx) => {
    const [row] = await tx
      .select()
      .from(conversation)
      .where(
        and(
          eq(conversation.id, id),
          eq(conversation.sellerId, buyer.sellerId),
          eq(conversation.buyerSessionId, buyer.buyerSessionId),
        ),
      )
      .for("share");
    if (!row) throw notFound("conversation");
    const messages = await loadMessages(id, tx);
    const active = Boolean(
      row.activeTurnId &&
        row.activeTurnExpiresAt &&
        row.activeTurnExpiresAt > new Date(),
    );
    const replyState: BuyerReplyState =
      row.handler !== "assistant"
        ? "idle"
        : active
          ? "answering"
          : messages.at(-1)?.role === "user"
            ? "interrupted"
            : "idle";
    return { control: toControl(row), messages, replyState };
  });
}

/** Reads the selected owner's conversation and its current pending question. */
export async function readSellerConversation(
  owner: OwnerPrincipal,
  id: string,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.readSellerConversation(owner, id);

  return transaction(getDb(), async (tx) => {
    const row = await ownerConversation(owner, id, tx, true);
    const [pending] = await tx
      .select({
        id: sellerQuestion.id,
        revision: sellerQuestion.revision,
        question: sellerQuestion.question,
      })
      .from(sellerQuestion)
      .where(
        and(
          eq(sellerQuestion.conversationId, id),
          eq(sellerQuestion.sellerId, owner.sellerId),
          eq(sellerQuestion.state, "open"),
        ),
      );
    return {
      control: toControl(row),
      messages: await loadMessages(id, tx),
      pending: pending ?? null,
    };
  });
}

/** Visible conversations belonging to this owner, most recently active first. */
export async function listSellerConversations(owner: OwnerPrincipal) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.listSellerConversations(owner);

  const [shop] = await getDb()
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  if (!shop) throw notFound("shop");
  const rows = await getDb()
    .select({
      id: conversation.id,
      handler: conversation.handler,
      revision: conversation.controlRevision,
      updatedAt: conversation.updatedAt,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.sellerId, shop.id),
        sql`exists(select 1 from ${message} where ${message.conversationId} = ${conversation.id})`,
      ),
    )
    .orderBy(desc(conversation.updatedAt))
    .limit(50);
  if (!rows.length) return [];
  const latest = await getDb()
    .selectDistinctOn([message.conversationId], {
      conversationId: message.conversationId,
      parts: message.parts,
    })
    .from(message)
    .where(
      inArray(
        message.conversationId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(message.conversationId, desc(message.sequence));
  const partsByConversation = new Map(
    latest.map((row) => [row.conversationId, row.parts as UIMessage["parts"]]),
  );
  return rows.map(({ updatedAt, ...row }) => ({
    ...row,
    updatedAt: updatedAt.toISOString(),
    preview: conversationText({
      id: row.id,
      role: "assistant",
      parts: partsByConversation.get(row.id) ?? [],
    }).slice(0, 180),
  }));
}

/** Delivers the owner's exact words once; chat text never approves a quote or payment. */
export async function sendSellerMessage(
  owner: OwnerPrincipal,
  raw: z.input<typeof SellerMessage>,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.sendSellerMessage(owner, raw);

  const input = SellerMessage.parse(raw);
  await transaction(getDb(), async (tx) => {
    const row = await ownerConversation(owner, input.conversationId, tx, true);
    const [prior] = await tx
      .select()
      .from(message)
      .where(and(eq(message.id, input.id), eq(message.conversationId, row.id)));
    if (prior) {
      const saved = sellerReplyOf({
        ...prior,
        parts: prior.parts as UIMessage["parts"],
      });
      if (
        !saved ||
        saved.text !== input.text ||
        saved.answerPending?.id !== input.answerPending?.id ||
        saved.answerPending?.revision !== input.answerPending?.revision
      )
        throw conflict(
          "This reply was already sent with different words or a different request selection. Review the conversation before sending again.",
        );
      return;
    }
    if (
      row.handler !== "seller" ||
      row.controlRevision !== input.expectedRevision
    )
      throw conflict(
        "Conversation control changed. Take over before replying.",
      );
    if (input.answerPending) {
      const [answered] = await tx
        .update(sellerQuestion)
        .set({
          state: "closed",
          answer: input.text,
          answeredAt: new Date(),
          revision: sql`${sellerQuestion.revision} + 1`,
          resumeClaimId: null,
          resumeError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sellerQuestion.id, input.answerPending.id),
            eq(sellerQuestion.revision, input.answerPending.revision),
            eq(sellerQuestion.state, "open"),
            eq(sellerQuestion.conversationId, row.id),
            eq(sellerQuestion.sellerId, owner.sellerId),
          ),
        )
        .returning({ id: sellerQuestion.id });
      if (!answered)
        throw conflict(
          "The pending request changed. Review it before sending this answer.",
        );
    }
    const created = await insertOnce(tx, row.id, {
      id: input.id,
      role: "assistant",
      parts: [
        {
          type: "data-seller-reply",
          data: {
            text: input.text,
            sentAt: new Date().toISOString(),
            ...(input.answerPending
              ? { answerPending: input.answerPending }
              : {}),
          },
        },
      ],
    });
    if (created)
      await recordAudit(tx, {
        actor: "owner",
        actorId: owner.userId,
        operation: "conversation.reply",
        targetType: "conversation",
        targetId: row.id,
        outcome: "ok",
        details: {
          messageId: input.id,
          answeredQuestionId: input.answerPending?.id ?? null,
        },
      });
  });
  return readSellerConversation(owner, input.conversationId);
}

/** Serialized owner conversation view. */
export type SellerConversation = Awaited<
  ReturnType<typeof readSellerConversation>
>;
