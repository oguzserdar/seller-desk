import { getStorage } from "@/server/storage";
/**
 * Quote operations. A quote thread holds immutable revisions; any change makes
 * the next revision, and only the latest review_ready revision can be paid.
 */
import {
  getDb,
  transaction,
  type Queryable,
  type Tx,
} from "@/server/db/client";
import {
  digitalQuoteLine,
  fulfillmentTask,
  orders,
  paymentAttempt,
  quote,
  seller,
  sellerQuestion,
} from "@/server/db/schema";
import type {
  PolicySnapshot,
  QuoteCharge,
  QuoteLine,
  Unresolved,
} from "@/server/db/types";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { assertAssistantTurn } from "./assistant-turn";
import { recordAudit } from "./audit";
import { conflict, DomainError, invalid, notFound } from "./errors";
import { loadOffersForQuote } from "./offers";
import { priceQuote, PricingRejection } from "./pricing";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";
import { policySnapshotOf, type SellerRow } from "./seller";
import { answerQuestion } from "./seller-questions";

export type QuoteRow = typeof quote.$inferSelect;
export type EffectiveQuoteStatus = QuoteRow["status"];

const OPEN_STATUSES = [
  "needs_information",
  "seller_review",
  "review_ready",
] as const;

export const QuoteRequest = z
  .object({
    threadId: z.uuid().optional(),
    lines: z
      .array(
        z
          .object({
            offerId: z.uuid(),
            quantity: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    buyerNote: z.string().trim().max(1000).optional(),
    budgetMinor: z
      .number()
      .int()
      .min(100)
      .max(100_000_000)
      .nullable()
      .optional(),
    deliveryRequested: z.boolean().optional(),
  })
  .strict();

export type QuoteRequest = z.input<typeof QuoteRequest>;

/** Quotes past their expiry read as expired even before a job marks them. */
export function effectiveStatus(
  row: Pick<QuoteRow, "status" | "expiresAt">,
  now = new Date(),
): EffectiveQuoteStatus {
  if (
    (OPEN_STATUSES as readonly string[]).includes(row.status) &&
    row.expiresAt <= now
  )
    return "expired";
  return row.status;
}

/** What the buyer sees about a quote, with the actions allowed next. */
export type BuyerQuoteView = {
  id: string;
  threadId: string;
  revision: number;
  status: EffectiveQuoteStatus;
  lines: QuoteLine[];
  charges: QuoteCharge[];
  unresolved: Unresolved[];
  subtotalMinor: number | null;
  totalMinor: number | null;
  currency: string;
  expiresAt: string;
  policy: PolicySnapshot;
  approvedScope: string | null;
  reviewReason: string | null;
  buyerNote: string | null;
  budgetMinor: number | null;
  deliveryRequested: boolean;
  isLatest: boolean;
  latestQuoteId: string;
  payment: {
    attemptId: string;
    state: string;
    approvalUrl: string | null;
  } | null;
  /** The paid order, with each fulfilment task's type and state so the buyer sees what actually happened. */
  order: {
    id: string;
    number: number;
    tasks: { type: string; state: string }[];
  } | null;
  next: string[];
};

function nextActions(
  status: EffectiveQuoteStatus,
  isLatest: boolean,
  hasPayment: boolean,
): string[] {
  if (!isLatest) return ["open_latest"];
  if (hasPayment) return ["check_payment"];
  switch (status) {
    case "review_ready":
      return ["accept_and_pay", "revise", "cancel"];
    case "needs_information":
      return ["revise", "cancel"];
    case "seller_review":
      return ["wait_for_seller", "cancel"];
    case "expired":
      return ["requote"];
    default:
      return [];
  }
}

async function latestInThread(
  q: Queryable,
  threadId: string,
): Promise<QuoteRow | undefined> {
  const [row] = await q
    .select()
    .from(quote)
    .where(eq(quote.threadId, threadId))
    .orderBy(desc(quote.revision))
    .limit(1);
  return row;
}

async function toBuyerView(
  q: Queryable,
  row: QuoteRow,
): Promise<BuyerQuoteView> {
  const latest = await latestInThread(q, row.threadId);
  const isLatest = latest?.id === row.id;
  const [attempt] = await q
    .select({
      id: paymentAttempt.id,
      state: paymentAttempt.state,
      approvalUrl: paymentAttempt.approvalUrl,
    })
    .from(paymentAttempt)
    .where(eq(paymentAttempt.quoteId, row.id));
  const [paid] = await q
    .select({ id: orders.id, number: orders.number })
    .from(orders)
    .where(eq(orders.quoteId, row.id));
  const order = paid
    ? {
        ...paid,
        tasks: await q
          .select({ type: fulfillmentTask.type, state: fulfillmentTask.state })
          .from(fulfillmentTask)
          .where(eq(fulfillmentTask.orderId, paid.id)),
      }
    : null;
  const status = effectiveStatus(row);
  return {
    id: row.id,
    threadId: row.threadId,
    revision: row.revision,
    status,
    lines: row.lines,
    charges: row.charges,
    unresolved: row.unresolved,
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    currency: row.currency,
    expiresAt: row.expiresAt.toISOString(),
    policy: row.policySnapshot,
    approvedScope: row.approvedScope,
    reviewReason: row.reviewReason,
    buyerNote: row.buyerNote,
    budgetMinor: row.budgetMinor,
    deliveryRequested: row.deliveryRequested,
    isLatest,
    latestQuoteId: latest?.id ?? row.id,
    payment: attempt
      ? {
          attemptId: attempt.id,
          state: attempt.state,
          approvalUrl:
            attempt.state === "order_created" ? attempt.approvalUrl : null,
        }
      : null,
    order: order ?? null,
    next: nextActions(status, isLatest, Boolean(attempt)),
  };
}

type PriceAndInsertArgs = {
  tx: Tx;
  sellerRow: SellerRow;
  buyerSessionId: string;
  threadId: string;
  revision: number;
  request: z.output<typeof QuoteRequest>;
  scopeApproved: boolean;
  approvedScope: string | null;
  sellerPrices?: ReadonlyMap<string, number>;
  retainedExpiry?: Date;
};

async function priceAndInsert(args: PriceAndInsertArgs): Promise<QuoteRow> {
  const { tx, sellerRow, request } = args;
  const ids = request.lines.map((line) => line.offerId);
  const rows = await loadOffersForQuote(sellerRow.id, ids, tx);
  const offers = new Map(
    rows.map(({ offer, stock }) => [
      offer.id,
      { offer, stock: stock ?? undefined },
    ]),
  );
  let priced;
  try {
    priced = priceQuote({
      sellerCurrency: sellerRow.currency,
      policy: policySnapshotOf(sellerRow),
      lines: request.lines,
      offers,
      budgetMinor: request.budgetMinor ?? null,
      deliveryRequested: request.deliveryRequested ?? false,
      buyerNote: request.buyerNote,
      scopeApproved: args.scopeApproved,
      sellerPrices: args.sellerPrices,
    });
  } catch (error) {
    if (error instanceof PricingRejection) throw invalid(error.message);
    throw error;
  }
  const [inserted] = await tx
    .insert(quote)
    .values({
      threadId: args.threadId,
      revision: args.revision,
      sellerId: sellerRow.id,
      buyerSessionId: args.buyerSessionId,
      status: priced.status,
      lines: priced.lines,
      charges: priced.charges,
      unresolved: priced.unresolved,
      policySnapshot: policySnapshotOf(sellerRow),
      subtotalMinor: priced.subtotalMinor,
      totalMinor: priced.totalMinor,
      currency: priced.currency,
      buyerNote: request.buyerNote ?? null,
      budgetMinor: request.budgetMinor ?? null,
      deliveryRequested: request.deliveryRequested ?? false,
      reviewReason: priced.reviewReason,
      approvedScope: args.approvedScope,
      sellerApprovedAt: args.scopeApproved ? new Date() : null,
      expiresAt:
        args.retainedExpiry ??
        new Date(Date.now() + sellerRow.quoteTtlMinutes * 60_000),
    })
    .returning();
  if (!inserted) throw new Error("quote insert returned nothing");
  for (const line of priced.lines.filter((line) => line.kind === "digital")) {
    const source = offers.get(line.offerId)?.offer;
    if (!source?.digitalAssetId || !source.accessDays)
      throw invalid("This download is not ready. Contact the seller.");
    await tx
      .insert(digitalQuoteLine)
      .values({
        quoteId: inserted.id,
        offerId: line.offerId,
        assetId: source.digitalAssetId,
        accessDays: source.accessDays,
      });
  }
  return inserted;
}

/**
 * Creates a quote (or the next revision of the buyer's existing thread) from
 * offer ids and quantities. Prices, charges and availability come from the server.
 */
export async function proposeQuote(
  buyer: BuyerPrincipal,
  raw: QuoteRequest,
): Promise<BuyerQuoteView> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.quotes.proposeQuote(buyer, raw);

  const parsed = QuoteRequest.safeParse(raw);
  if (!parsed.success)
    throw invalid(
      "That quote request was not valid. Choose offers from the list and try again.",
    );
  const request = parsed.data;
  return transaction(getDb(), async (tx) => {
    await assertAssistantTurn(buyer, tx, true);
    const [sellerRow] = await tx
      .select()
      .from(seller)
      .where(eq(seller.id, buyer.sellerId));
    if (!sellerRow) throw notFound("shop");
    let threadId: string = crypto.randomUUID();
    let revision = 1;
    let previous: QuoteRow | undefined;
    if (request.threadId) {
      const [locked] = await tx
        .select()
        .from(quote)
        .where(
          and(
            eq(quote.threadId, request.threadId),
            eq(quote.buyerSessionId, buyer.buyerSessionId),
          ),
        )
        .orderBy(desc(quote.revision))
        .limit(1)
        .for("update");
      if (!locked) throw notFound("quote");
      if (locked.status === "accepted" || locked.status === "consumed") {
        throw conflict(
          "This quote is already being paid. Check its payment status instead.",
          ["check_payment"],
        );
      }
      previous = locked;
      threadId = locked.threadId;
      revision = locked.revision + 1;
    }
    // A budget-only change keeps the seller's offer until its original expiry.
    // Work, quantity, terms or catalog changes require a fresh seller decision.
    let retainReview = Boolean(
      previous?.sellerApprovedAt &&
        previous.approvedScope &&
        OPEN_STATUSES.includes(
          effectiveStatus(previous) as (typeof OPEN_STATUSES)[number],
        ) &&
        previous.policySnapshot.policyRevision === sellerRow.policyRevision &&
        previous.buyerNote === (request.buyerNote ?? null) &&
        previous.deliveryRequested === (request.deliveryRequested ?? false) &&
        previous.lines.length === request.lines.length &&
        previous.lines.every((line) =>
          request.lines.some(
            (next) =>
              next.offerId === line.offerId && next.quantity === line.quantity,
          ),
        ),
    );
    if (retainReview && previous) {
      const current = await loadOffersForQuote(
        sellerRow.id,
        previous.lines.map((line) => line.offerId),
        tx,
      );
      retainReview = previous.lines.every((line) =>
        current.some(
          ({ offer }) =>
            offer.id === line.offerId &&
            offer.published &&
            offer.revision === line.offerRevision,
        ),
      );
    }
    const created = await priceAndInsert({
      tx,
      sellerRow,
      buyerSessionId: buyer.buyerSessionId,
      threadId,
      revision,
      request,
      scopeApproved: retainReview,
      approvedScope: retainReview ? previous!.approvedScope : null,
      sellerPrices: retainReview
        ? new Map(
            previous!.lines
              .filter(
                (line) =>
                  line.kind === "service" && line.unitAmountMinor !== null,
              )
              .map((line) => [line.offerId, line.unitAmountMinor!]),
          )
        : undefined,
      retainedExpiry: retainReview ? previous!.expiresAt : undefined,
    });
    if (previous) {
      await tx
        .update(quote)
        .set({ status: "replaced" })
        .where(
          and(
            eq(quote.threadId, threadId),
            notInArray(quote.status, ["accepted", "consumed"]),
            notInArray(quote.id, [created.id]),
          ),
        );
    }
    await recordAudit(tx, {
      actor: "buyer",
      actorId: buyer.buyerSessionId,
      operation: "quote.propose",
      targetType: "quote",
      targetId: created.id,
      outcome: "ok",
      details: {
        revision,
        status: created.status,
        totalMinor: created.totalMinor,
      },
    });
    return toBuyerView(tx, created);
  });
}

/** Reads one of the buyer's own quotes. Another buyer's quote id reads as not found. */
export async function getBuyerQuote(
  buyer: BuyerPrincipal,
  quoteId: string,
): Promise<BuyerQuoteView> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.quotes.getBuyerQuote(buyer, quoteId);

  const db = getDb();
  const [row] = await db
    .select()
    .from(quote)
    .where(
      and(
        eq(quote.id, quoteId),
        eq(quote.buyerSessionId, buyer.buyerSessionId),
      ),
    );
  if (!row) throw notFound("quote");
  return toBuyerView(db, row);
}

/** The buyer cancels an open quote. Accepted quotes are handled by the payment record. */
export async function cancelQuote(
  buyer: BuyerPrincipal,
  input: { quoteId: string; revision: number },
): Promise<BuyerQuoteView> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.quotes.cancelQuote(buyer, input);

  return transaction(getDb(), async (tx) => {
    const [row] = await tx
      .select()
      .from(quote)
      .where(
        and(
          eq(quote.id, input.quoteId),
          eq(quote.buyerSessionId, buyer.buyerSessionId),
        ),
      )
      .for("update");
    if (!row) throw notFound("quote");
    if (row.revision !== input.revision)
      throw conflict("This quote changed. Review the latest version.", [
        "open_latest",
      ]);
    if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) {
      throw conflict("This quote can no longer be cancelled here.", [
        "check_payment",
      ]);
    }
    const [updated] = await tx
      .update(quote)
      .set({ status: "cancelled" })
      .where(eq(quote.id, row.id))
      .returning();
    await recordAudit(tx, {
      actor: "buyer",
      actorId: buyer.buyerSessionId,
      operation: "quote.cancel",
      targetType: "quote",
      targetId: row.id,
      outcome: "ok",
    });
    return toBuyerView(tx, updated as QuoteRow);
  });
}

/** Owner-only review input. Price entries cover only services awaiting a price. */
export const ServiceQuoteReview = z
  .object({
    quoteId: z.uuid(),
    expectedRevision: z.number().int().min(1),
    approvedScope: z.string().trim().min(3).max(1000),
    prices: z
      .array(
        z
          .object({
            offerId: z.uuid(),
            unitAmountMinor: z.number().int().min(1).max(10_000_000),
          })
          .strict(),
      )
      .max(10),
    answer: z
      .object({
        questionId: z.uuid(),
        expectedRevision: z.number().int().min(1),
        answer: z.string().trim().min(1).max(1000),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * The owner confirms the scope and any custom service prices. This writes a new revision
 * that the buyer must accept; the owner can never approve payment on their behalf.
 * An explicit answer to the same buyer's open question commits with the quote.
 */
export async function approveQuoteScope(
  owner: OwnerPrincipal,
  raw: z.input<typeof ServiceQuoteReview>,
): Promise<QuoteRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.quotes.approveQuoteScope(owner, raw);

  const parsed = ServiceQuoteReview.safeParse(raw);
  if (!parsed.success)
    throw invalid(
      "Provide the confirmed scope and a valid price for each custom service.",
    );
  const input = parsed.data;
  const { approvedScope } = input;
  return transaction(getDb(), async (tx) => {
    const [sellerRow] = await tx
      .select()
      .from(seller)
      .where(
        and(
          eq(seller.id, owner.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      );
    if (!sellerRow) throw notFound("shop");
    const [row] = await tx
      .select()
      .from(quote)
      .where(
        and(eq(quote.id, input.quoteId), eq(quote.sellerId, owner.sellerId)),
      )
      .for("update");
    if (!row) throw notFound("quote");
    if (row.revision !== input.expectedRevision)
      throw conflict(
        "This quote changed after you opened it. Review it again.",
      );
    const latest = await latestInThread(tx, row.threadId);
    if (latest?.id !== row.id)
      throw conflict(
        "The buyer has a newer version of this quote. Review that one.",
      );
    if (effectiveStatus(row) !== "seller_review")
      throw conflict("This quote is not waiting for your review.");
    const unpriced = row.lines.filter((line) => line.unitAmountMinor === null);
    const sellerPrices = new Map(
      input.prices.map((price) => [price.offerId, price.unitAmountMinor]),
    );
    if (
      sellerPrices.size !== input.prices.length ||
      sellerPrices.size !== unpriced.length ||
      unpriced.some((line) => !sellerPrices.has(line.offerId))
    ) {
      throw invalid(
        "Set one price for each custom service. Fixed catalog prices cannot be changed here.",
      );
    }
    const currentOffers = await loadOffersForQuote(
      owner.sellerId,
      row.lines.map((line) => line.offerId),
      tx,
    );
    if (
      row.lines.some((line) => {
        const current = currentOffers.find(
          ({ offer }) => offer.id === line.offerId,
        )?.offer;
        return (
          !current?.published ||
          current.revision !== line.offerRevision ||
          current.unitAmountMinor !== line.unitAmountMinor
        );
      })
    )
      throw conflict(
        "An offer changed after this request. The buyer needs a fresh quote.",
      );

    if (input.answer) {
      const [question] = await tx
        .select({ id: sellerQuestion.id })
        .from(sellerQuestion)
        .where(
          and(
            eq(sellerQuestion.id, input.answer.questionId),
            eq(sellerQuestion.sellerId, owner.sellerId),
            eq(sellerQuestion.buyerSessionId, row.buyerSessionId),
          ),
        )
        .for("update");
      if (!question) throw notFound("question");
      await answerQuestion(owner, input.answer, tx);
    }
    const created = await priceAndInsert({
      tx,
      sellerRow,
      buyerSessionId: row.buyerSessionId,
      threadId: row.threadId,
      revision: row.revision + 1,
      request: {
        lines: row.lines.map((line) => ({
          offerId: line.offerId,
          quantity: line.quantity,
        })),
        buyerNote: row.buyerNote ?? undefined,
        budgetMinor: row.budgetMinor,
        deliveryRequested: row.deliveryRequested,
      },
      scopeApproved: true,
      approvedScope,
      sellerPrices,
    });
    await tx
      .update(quote)
      .set({ status: "replaced" })
      .where(eq(quote.id, row.id));
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "quote.approve_scope",
      targetType: "quote",
      targetId: created.id,
      outcome: "ok",
      details: { fromRevision: row.revision, status: created.status },
    });
    return created;
  });
}

/** The owner declines a quote waiting for review, with a reason the buyer sees. */
export async function declineQuote(
  owner: OwnerPrincipal,
  input: { quoteId: string; expectedRevision: number; reason: string },
): Promise<QuoteRow> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.quotes.declineQuote(owner, input);

  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500)
    throw invalid("Give the buyer a short reason (3 to 500 characters).");
  return transaction(getDb(), async (tx) => {
    const [row] = await tx
      .select()
      .from(quote)
      .where(
        and(eq(quote.id, input.quoteId), eq(quote.sellerId, owner.sellerId)),
      )
      .for("update");
    if (!row) throw notFound("quote");
    if (row.revision !== input.expectedRevision)
      throw conflict(
        "This quote changed after you opened it. Review it again.",
      );
    if (effectiveStatus(row) !== "seller_review")
      throw conflict("This quote is not waiting for your review.");
    const [updated] = await tx
      .update(quote)
      .set({
        status: "cancelled",
        reviewReason: `Declined by the seller: ${reason}`,
      })
      .where(eq(quote.id, row.id))
      .returning();
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "quote.decline",
      targetType: "quote",
      targetId: row.id,
      outcome: "ok",
    });
    return updated as QuoteRow;
  });
}

/** Open quotes the owner must review, newest first. */
export async function listQuotesAwaitingReview(
  owner: OwnerPrincipal,
  q?: Queryable,
): Promise<QuoteRow[]> {
  const backend = getStorage();
  if (!q && backend.kind === "d1")
    return backend.quotes.listQuotesAwaitingReview(owner);
  q ??= getDb();

  const rows = await q
    .select()
    .from(quote)
    .where(
      and(
        eq(quote.sellerId, owner.sellerId),
        inArray(quote.status, ["seller_review"]),
      ),
    )
    .orderBy(desc(quote.createdAt))
    .limit(100);
  return rows.filter((row) => effectiveStatus(row) === "seller_review");
}

export { DomainError };
