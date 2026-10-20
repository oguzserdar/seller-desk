/**
 * Owner assistant proposals. The model may only propose an action from a
 * closed list; the owner approves it; the server re-checks the target's
 * version and then runs the same domain operation as the desk button.
 * A proposal is claimed atomically, so a double approval runs once.
 */
import { getDb } from "@/server/db/client";
import {
  fulfillmentTask,
  orders,
  ownerProposal,
  paymentAttempt,
} from "@/server/db/schema";
import type { ProposalResult } from "@/server/db/types";
import { reconcilePayment } from "@/server/payments/engine";
import { getStorage } from "@/server/storage";
import { and, eq, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "./audit";
import { getDigitalAccessBlocks, retryAccess } from "./digital";
import { conflict, invalid, notFound } from "./errors";
import { completePickup } from "./orders";
import type { OwnerPrincipal } from "./principal";

export const PROPOSAL_ACTIONS = [
  "retry_access",
  "mark_picked_up",
  "check_payment",
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

const PROPOSAL_TTL_MS = 10 * 60_000;
const UNCERTAIN = [
  "create_in_flight",
  "approval_observed",
  "capture_in_flight",
  "verification_pending",
];

export const ProposeInput = z
  .object({ action: z.enum(PROPOSAL_ACTIONS), targetId: z.uuid() })
  .strict();

export type ProposalView = {
  proposalId: string;
  action: ProposalAction;
  summary: string;
  consequence: string;
  approveLabel: string;
  targetHref: string;
  expiresAt: string;
};

type Target = {
  targetType: "order" | "payment_attempt";
  targetRevision: number;
  summary: string;
  consequence: string;
  approveLabel: string;
  href: string;
  taskId: string | null;
};

async function openTask(
  owner: OwnerPrincipal,
  orderId: string,
  type: "pickup" | "digital_access",
) {
  const backend = getStorage();
  const row =
    backend.kind === "d1"
      ? await backend.proposals.openTask(owner, orderId, type)
      : (
          await getDb()
            .select({ order: orders, task: fulfillmentTask })
            .from(orders)
            .innerJoin(
              fulfillmentTask,
              and(
                eq(fulfillmentTask.orderId, orders.id),
                eq(fulfillmentTask.type, type),
              ),
            )
            .where(
              and(eq(orders.id, orderId), eq(orders.sellerId, owner.sellerId)),
            )
        )[0];
  if (!row) throw notFound("order");
  if (row.task.state === "completed")
    throw invalid(
      type === "pickup"
        ? "That pickup is already recorded."
        : "Download delivery was recorded earlier. Retrying delivery does not renew expired or withdrawn access.",
    );
  return row;
}

async function resolveTarget(
  owner: OwnerPrincipal,
  action: ProposalAction,
  targetId: string,
): Promise<Target> {
  if (action === "retry_access") {
    const { order, task } = await openTask(owner, targetId, "digital_access");
    const blocked = (await getDigitalAccessBlocks([order])).get(order.id);
    if (blocked)
      throw invalid(
        `${blocked.reason} Review the purchased access terms with the buyer. Retrying cannot renew or reinstate access.`,
      );
    return {
      targetType: "order",
      targetRevision: task.revision,
      summary: `Retry download access for #${order.number}?`,
      consequence: "This does not charge the buyer again.",
      approveLabel: "Retry access",
      href: `/owner/orders/${order.id}`,
      taskId: task.id,
    };
  }
  if (action === "mark_picked_up") {
    const { order, task } = await openTask(owner, targetId, "pickup");
    return {
      targetType: "order",
      targetRevision: task.revision,
      summary: `Mark #${order.number} as picked up?`,
      consequence:
        "This records that the buyer collected it. Nothing is charged.",
      approveLabel: "Mark picked up",
      href: `/owner/orders/${order.id}`,
      taskId: task.id,
    };
  }
  const backend = getStorage();
  const attempt =
    backend.kind === "d1"
      ? await backend.proposals.payment(owner, targetId)
      : (
          await getDb()
            .select()
            .from(paymentAttempt)
            .where(
              and(
                eq(paymentAttempt.id, targetId),
                eq(paymentAttempt.sellerId, owner.sellerId),
              ),
            )
        )[0];
  if (!attempt) throw notFound("payment");
  if (!UNCERTAIN.includes(attempt.state))
    throw invalid("That payment does not need a check.");
  return {
    targetType: "payment_attempt",
    targetRevision: 1,
    summary: "Check this payment with PayPal?",
    consequence:
      "If the buyer already approved it in PayPal, the payment is completed. Otherwise nothing changes.",
    approveLabel: "Check with PayPal",
    href: `/owner/payments/${attempt.id}`,
    taskId: null,
  };
}

/** Records a pending proposal. Nothing runs until the owner approves it. */
export async function proposeAction(
  owner: OwnerPrincipal,
  raw: z.input<typeof ProposeInput>,
): Promise<ProposalView> {
  const input = ProposeInput.parse(raw);
  const target = await resolveTarget(owner, input.action, input.targetId);
  const args = { action: input.action, taskId: target.taskId };
  const values = {
    sellerId: owner.sellerId,
    verb: input.action,
    targetType: target.targetType,
    targetId: input.targetId,
    targetRevision: target.targetRevision,
    args,
    argsHash: createHash("sha256")
      .update(
        JSON.stringify([
          input.action,
          input.targetId,
          target.targetRevision,
          args,
        ]),
      )
      .digest("hex"),
    summary: target.summary,
    state: "pending" as const,
    expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
  };
  const backend = getStorage();
  const row =
    backend.kind === "d1"
      ? await backend.proposals.insert(owner, values)
      : (await getDb().insert(ownerProposal).values(values).returning())[0];
  if (!row) throw new Error("proposal insert returned nothing");
  return {
    proposalId: row.id,
    action: input.action,
    summary: target.summary,
    consequence: target.consequence,
    approveLabel: target.approveLabel,
    targetHref: target.href,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export const DecideInput = z
  .object({ proposalId: z.uuid(), approve: z.boolean() })
  .strict();
export type ProposalDecision = {
  state: "executed" | "rejected" | "failed";
  message: string;
};

async function execute(
  owner: OwnerPrincipal,
  row: typeof ownerProposal.$inferSelect,
): Promise<ProposalResult> {
  const action = row.verb as ProposalAction;
  if (action === "retry_access") {
    const outcome = await retryAccess(owner, row.targetId);
    return outcome.outcome === "granted"
      ? {
          outcome: "ok",
          message: "Access is working again. The buyer can download now.",
          observed: { grants: outcome.grantIds.length },
        }
      : {
          outcome: "failed",
          message: `Access is still failing: ${outcome.reason}`,
        };
  }
  if (action === "mark_picked_up") {
    const taskId = typeof row.args.taskId === "string" ? row.args.taskId : null;
    if (!taskId)
      return {
        outcome: "failed",
        message: "This proposal has no pickup task.",
      };
    const task = await completePickup(owner, {
      taskId,
      expectedRevision: row.targetRevision,
      note: "Picked up",
    });
    return {
      outcome: "ok",
      message: "Recorded as picked up.",
      observed: { state: task.state },
    };
  }
  const view = await reconcilePayment(owner, row.targetId, {
    mayCapture: true,
  });
  return {
    outcome: "ok",
    message: view.headline,
    observed: { state: view.state },
  };
}

/** Approves or declines a pending proposal; an approval re-checks the target version first. */
export async function decideProposal(
  owner: OwnerPrincipal,
  raw: z.input<typeof DecideInput>,
): Promise<ProposalDecision> {
  const input = DecideInput.parse(raw);
  const backend = getStorage();
  const claimed =
    backend.kind === "d1"
      ? await backend.proposals.claim(owner, input.proposalId, input.approve)
      : await claimPostgres(owner, input.proposalId, input.approve);
  if (!input.approve) {
    if (backend.kind === "d1")
      await backend.proposals.finish(owner, claimed, null);
    else
      await recordAudit(getDb(), {
        actor: "owner",
        actorId: owner.userId,
        operation: `proposal.${claimed.verb}`,
        targetType: "owner_proposal",
        targetId: claimed.id,
        outcome: "noop",
      });
    return { state: "rejected", message: "Left as it is." };
  }

  let result: ProposalResult;
  try {
    if (claimed.verb !== "check_payment") {
      const fresh = await resolveTarget(
        owner,
        claimed.verb as ProposalAction,
        claimed.targetId,
      );
      if (fresh.targetRevision !== claimed.targetRevision)
        throw conflict(
          "The order changed after this was suggested. Ask again.",
        );
    }
    result = await execute(owner, claimed);
  } catch (error) {
    result = {
      outcome: "failed",
      message:
        error instanceof Error ? error.message : "The action did not finish.",
    };
  }
  if (backend.kind === "d1")
    await backend.proposals.finish(owner, claimed, result);
  else {
    await getDb()
      .update(ownerProposal)
      .set({
        state: result.outcome === "failed" ? "failed" : "executed",
        result,
      })
      .where(eq(ownerProposal.id, claimed.id));
    await recordAudit(getDb(), {
      actor: "owner",
      actorId: owner.userId,
      operation: `proposal.${claimed.verb}`,
      targetType: "owner_proposal",
      targetId: claimed.id,
      outcome: result.outcome === "failed" ? "failed" : "ok",
    });
  }
  return {
    state: result.outcome === "failed" ? "failed" : "executed",
    message: result.message,
  };
}

async function claimPostgres(
  owner: OwnerPrincipal,
  id: string,
  approve: boolean,
) {
  const db = getDb();
  await db
    .update(ownerProposal)
    .set({ state: "expired" })
    .where(
      and(
        eq(ownerProposal.id, id),
        eq(ownerProposal.sellerId, owner.sellerId),
        eq(ownerProposal.state, "pending"),
        lt(ownerProposal.expiresAt, sql`now()`),
      ),
    );
  const [claimed] = await db
    .update(ownerProposal)
    .set({ state: approve ? "executed" : "rejected", decidedAt: new Date() })
    .where(
      and(
        eq(ownerProposal.id, id),
        eq(ownerProposal.sellerId, owner.sellerId),
        eq(ownerProposal.state, "pending"),
      ),
    )
    .returning();
  if (!claimed) {
    const [existing] = await db
      .select({ state: ownerProposal.state })
      .from(ownerProposal)
      .where(
        and(
          eq(ownerProposal.id, id),
          eq(ownerProposal.sellerId, owner.sellerId),
        ),
      );
    if (!existing) throw notFound("proposal");
    throw conflict(
      existing.state === "expired"
        ? "This suggestion expired. Ask again for a fresh one."
        : "This suggestion was already decided.",
    );
  }
  return claimed;
}
