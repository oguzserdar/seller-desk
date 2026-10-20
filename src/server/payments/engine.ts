/**
 * The payment state machine.
 *
 *   planned -> create_in_flight -> order_created -> approval_observed
 *     -> capture_in_flight -> verification_pending -> paid | failed | cancelled
 *
 * Rules this file keeps:
 * - Request ids and payload hashes are saved before any PayPal call.
 * - A timeout is uncertain, never failed; the next check reads PayPal first.
 * - Only one executor works an attempt at a time (lease); a slower executor
 *   whose lease was taken over cannot write (fence).
 * - No database transaction stays open across a network call.
 * - Paid requires independent evidence (see evidence.ts).
 */
import { formatMoney } from "@/lib/money";
import { hashPayload } from "@/server/crypto";
import {
  PAYMENT_STATES,
  type paymentAttempt,
  type quote,
} from "@/server/db/schema";
import type { PaymentEvidence } from "@/server/db/types";
import { assertAssistantTurn } from "@/server/domain/assistant-turn";
import { issueGrants } from "@/server/domain/digital";
import { DomainError } from "@/server/domain/errors";
import type { BuyerPrincipal, Principal } from "@/server/domain/principal";
import { getServerConfig } from "@/server/env";
import { getPayPal } from "@/server/paypal";
import {
  type ProviderOrder,
  TransportRejectedError,
  TransportUncertainError,
} from "@/server/paypal/types";
import { getStorage } from "@/server/storage";
import { buildCreateRequest } from "./create-request";
import {
  evaluateEvidence,
  type ExpectedPayment,
  isAllowedApprovalUrl,
  precaptureFailures,
} from "./evidence";
import { recordPaidOrder } from "./paid";

export type PaymentState = (typeof PAYMENT_STATES)[number];
type AttemptRow = typeof paymentAttempt.$inferSelect;
type QuoteRow = typeof quote.$inferSelect;

/**
 * How long a lost create may be retried with the same PayPal-Request-Id.
 * Conservative value pending the grounded retention for Orders create; after
 * it, the attempt waits for the owner instead of risking a second order.
 */
export const CREATE_RETRY_WINDOW_MS = 3 * 60 * 60 * 1000;
const BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const UNAPPROVED_EXPIRY_MS = 60 * 60_000;

function backoff(checkCount: number): Date {
  const step =
    BACKOFF_MS[Math.min(checkCount, BACKOFF_MS.length - 1)] ?? 60_000;
  return new Date(Date.now() + step);
}

/* ---------- leases ---------- */

async function acquireLease(
  attemptId: string,
  states: PaymentState[],
): Promise<AttemptRow | null> {
  return getStorage().payments.acquireLease(attemptId, states);
}

/** Writes only if this executor still holds the lease it took (same fence). */
async function fenced(
  attempt: AttemptRow,
  patch: import("@/server/storage/payments").PaymentPatch,
): Promise<boolean> {
  return getStorage().payments.fencedPatch(attempt, patch);
}

async function releaseLease(attempt: AttemptRow): Promise<void> {
  await getStorage().payments.releaseLease(attempt);
}

async function markUncertain(
  attempt: AttemptRow,
  reason: string,
): Promise<void> {
  await fenced(attempt, {
    uncertainSince: attempt.uncertainSince ?? new Date(),
    checkCount: attempt.checkCount + 1,
    nextCheckAt: backoff(attempt.checkCount),
    lastError: reason,
  });
}

async function closeAttempt(
  attempt: AttemptRow,
  state: "failed" | "cancelled",
  reason: string,
  quoteStatus: "cancelled" | "expired",
): Promise<void> {
  await getStorage().payments.closeAttempt(attempt, state, reason, quoteStatus);
}

/* ---------- requests ---------- */

function createRequestFor(attempt: AttemptRow, quoteRow: QuoteRow) {
  return buildCreateRequest({
    attemptId: attempt.id,
    createRequestId: attempt.createRequestId,
    quoteRow,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    payeeMerchantId: attempt.payeeMerchantId ?? "",
    appUrl: getServerConfig().appUrl,
  });
}

/* ---------- start checkout ---------- */

/**
 * Accepts the buyer's reviewed quote revision, holds scarce stock and records
 * the payment attempt, then asks PayPal for an approval link. A second click
 * joins the same attempt.
 */
export async function startCheckout(
  buyer: BuyerPrincipal,
  input: { quoteId: string; revision: number },
): Promise<PaymentView> {
  const paypal = getPayPal();
  if (!paypal.ok) {
    throw new DomainError(
      "unavailable",
      "PayPal checkout is not switched on for this shop yet. You have not been charged.",
      ["contact_seller"],
    );
  }
  const config = getServerConfig();
  const holdAndRecord = () =>
    getStorage().checkout.holdAndRecord(buyer, input, {
      environment: paypal.transport.environment,
      payeeMerchantId: paypal.payeeMerchantId,
      appUrl: config.appUrl,
    });
  let attemptId: string;
  try {
    attemptId = await holdAndRecord();
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "sold_out"))
      throw error;
    // An abandoned checkout's expired hold may be what blocks the item. Settle those through PayPal, then try once more.
    const goods = await getStorage().payments.buyerGoods(buyer, input.quoteId);
    if ((await settleExpiredHolds(goods)) === 0) throw error;
    attemptId = await holdAndRecord();
  }
  await driveCreate(attemptId);
  return getPaymentView(buyer, attemptId);
}

/**
 * Settles other checkouts whose holds on these offers expired, so an abandoned
 * checkout cannot keep the last item off sale until a scheduled job runs. Each
 * goes through reconcile: PayPal is read first, a late approval whose hold is
 * still in place is honoured, and an uncertain attempt keeps its hold.
 */
async function settleExpiredHolds(
  offerIds: string[],
  limit = 5,
): Promise<number> {
  if (offerIds.length === 0) return 0;
  const stale = await getStorage().payments.staleHoldAttempts(offerIds, limit);
  for (const attemptId of stale) {
    try {
      await driveReconcile(attemptId, true);
    } catch (error) {
      console.error("settling an expired hold failed", attemptId, error);
    }
  }
  return stale.length;
}

/* ---------- drivers ---------- */

async function driveCreate(
  attemptId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const attempt = await acquireLease(attemptId, [
    "planned",
    "create_in_flight",
  ]);
  if (!attempt) return;
  try {
    const paypal = getPayPal();
    if (!paypal.ok) {
      await fenced(attempt, {
        lastError: "paypal_not_configured",
        nextCheckAt: backoff(attempt.checkCount),
      });
      return;
    }
    if (attempt.environment !== paypal.transport.environment) {
      await fenced(attempt, {
        lastError: "environment_mismatch",
        nextCheckAt: null,
      });
      return;
    }
    if (
      attempt.uncertainSince &&
      Date.now() - attempt.createdAt.getTime() > CREATE_RETRY_WINDOW_MS
    ) {
      await fenced(attempt, {
        lastError: "create_uncertain_needs_owner",
        nextCheckAt: null,
      });
      return;
    }
    const quoteRow = await getStorage().payments.getQuote(attempt.quoteId);
    if (!quoteRow) throw new Error("attempt without quote");
    const request = createRequestFor(attempt, quoteRow);
    if (hashPayload(request) !== attempt.createRequestHash) {
      await closeAttempt(
        attempt,
        "failed",
        "create_request_changed",
        "cancelled",
      );
      return;
    }
    await fenced(attempt, { state: "create_in_flight" });
    let order: ProviderOrder;
    try {
      order = await paypal.transport.createOrder(request, signal);
    } catch (error) {
      if (error instanceof TransportUncertainError) {
        await markUncertain(attempt, `create_${error.detail}`);
        return;
      }
      if (error instanceof TransportRejectedError) {
        await closeAttempt(
          attempt,
          "failed",
          `paypal_rejected_create:${error.issue ?? error.status}`,
          "cancelled",
        );
        return;
      }
      throw error;
    }
    if (
      !isAllowedApprovalUrl(order.approvalUrl, paypal.transport.approvalHosts)
    ) {
      await fenced(attempt, { providerOrderId: order.id });
      await closeAttempt(
        attempt,
        "failed",
        "approval_link_unexpected",
        "cancelled",
      );
      return;
    }
    const holdEnds = await holdExpiry(attempt.quoteId);
    await fenced(attempt, {
      state: "order_created",
      providerOrderId: order.id,
      approvalUrl: order.approvalUrl,
      lastProviderStatus: order.status,
      uncertainSince: null,
      lastError: null,
      nextCheckAt: holdEnds ?? new Date(Date.now() + UNAPPROVED_EXPIRY_MS),
    });
  } finally {
    await releaseLease(attempt);
  }
}

async function holdExpiry(quoteId: string): Promise<Date | null> {
  const rows = (await getStorage().payments.reservations(quoteId)).filter(
    (row) => row.state === "held",
  );
  return rows.length
    ? new Date(Math.min(...rows.map((row) => row.expiresAt.getTime())))
    : null;
}

async function approvalWindowOver(attempt: AttemptRow): Promise<boolean> {
  const rows = await getStorage().payments.reservations(attempt.quoteId);
  if (!rows.length)
    return Date.now() - attempt.createdAt.getTime() > UNAPPROVED_EXPIRY_MS;
  const held = rows.filter((row) => row.state === "held");
  return (
    !held.length ||
    Math.min(...held.map((row) => row.expiresAt.getTime())) <= Date.now()
  );
}

async function holdsStillValid(attempt: AttemptRow): Promise<boolean> {
  return (await getStorage().payments.reservations(attempt.quoteId)).every(
    (row) => row.state === "held" || row.state === "captured",
  );
}

function expectedFor(
  attempt: AttemptRow,
  providerOrderId: string,
): ExpectedPayment {
  return {
    environment: attempt.environment,
    providerOrderId,
    quoteId: attempt.quoteId,
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
    payeeMerchantId: attempt.payeeMerchantId ?? "",
  };
}

async function holdForReview(
  attempt: AttemptRow,
  reason: string,
  evidence?: PaymentEvidence,
): Promise<void> {
  await getStorage().payments.holdForReview(attempt, reason, evidence);
}

async function driveReconcile(
  attemptId: string,
  mayCapture: boolean,
  signal?: AbortSignal,
  assistant?: BuyerPrincipal,
): Promise<void> {
  if (signal?.aborted) return;
  const attempt = await acquireLease(attemptId, [
    "order_created",
    "approval_observed",
    "capture_in_flight",
    "verification_pending",
  ]);
  if (!attempt) return;
  try {
    const paypal = getPayPal();
    if (
      !paypal.ok ||
      attempt.environment !== paypal.transport.environment ||
      !attempt.providerOrderId
    ) {
      await fenced(attempt, {
        lastError: paypal.ok ? "environment_mismatch" : "paypal_not_configured",
        nextCheckAt: backoff(attempt.checkCount),
      });
      return;
    }
    const orderId = attempt.providerOrderId;
    let order: ProviderOrder;
    try {
      order = await paypal.transport.getOrder(orderId, signal);
      if (!order.capture && order.status === "APPROVED") {
        await fenced(attempt, {
          state: "approval_observed",
          lastProviderStatus: "APPROVED",
        });
        if (!mayCapture) return;
        if (!(await holdsStillValid(attempt))) {
          await closeAttempt(
            attempt,
            "cancelled",
            "hold_expired_before_capture",
            "expired",
          );
          return;
        }
        // Never capture an order that does not match what we created; the owner reviews it and stock stays held.
        const failed = precaptureFailures(order, expectedFor(attempt, orderId));
        if (failed.length > 0) {
          await holdForReview(attempt, `precapture:${failed.join(",")}`);
          return;
        }
        // This transaction orders capture dispatch against takeover. Once
        // dispatched, verified payment evidence must still be reconciled.
        signal?.throwIfAborted();
        const dispatched = await getStorage().payments.dispatchCapture(
          attempt,
          {
            state: "capture_in_flight",
            captureRequestHash:
              attempt.captureRequestHash ??
              hashPayload({ orderId, requestId: attempt.captureRequestId }),
          },
          assistant,
          signal,
        );
        if (!dispatched) return;
        try {
          await paypal.transport.captureOrder(
            orderId,
            attempt.captureRequestId,
            signal,
          );
        } catch (error) {
          if (error instanceof TransportRejectedError) {
            if (error.issue === "INSTRUMENT_DECLINED") {
              await fenced(attempt, {
                state: "order_created",
                lastError: "instrument_declined",
                lastProviderStatus: "APPROVED",
              });
              return;
            }
            if (error.issue !== "ORDER_ALREADY_CAPTURED") {
              await closeAttempt(
                attempt,
                "failed",
                `paypal_rejected_capture:${error.issue ?? error.status}`,
                "cancelled",
              );
              return;
            }
          } else if (!(error instanceof TransportUncertainError)) {
            throw error;
          }
          // Uncertain or already captured: the independent read below decides.
        }
        order = await paypal.transport.getOrder(orderId, signal);
      }
    } catch (error) {
      if (error instanceof TransportUncertainError) {
        await markUncertain(attempt, `read_${error.detail}`);
        return;
      }
      throw error;
    }

    if (!order.capture) {
      if (order.status === "VOIDED") {
        await closeAttempt(attempt, "cancelled", "paypal_voided", "cancelled");
        return;
      }
      if (await approvalWindowOver(attempt)) {
        await closeAttempt(
          attempt,
          "cancelled",
          "approval_window_expired",
          "expired",
        );
        return;
      }
      await fenced(attempt, {
        state:
          order.status === "APPROVED" ? "approval_observed" : "order_created",
        lastProviderStatus: order.status,
        nextCheckAt:
          (await holdExpiry(attempt.quoteId)) ??
          new Date(Date.now() + 15 * 60_000),
      });
      return;
    }

    const verdict = evaluateEvidence(order, expectedFor(attempt, orderId));
    switch (verdict.outcome) {
      case "paid": {
        let paid;
        try {
          paid = await recordPaidOrder({
            attemptId: attempt.id,
            expectedFence: attempt.fence,
            captureId: verdict.captureId,
            evidence: verdict.evidence,
            payer: order.payer,
          });
        } catch (error) {
          await fenced(attempt, {
            state: "verification_pending",
            evidence: verdict.evidence,
            lastError: "paid_record_failed",
            nextCheckAt: backoff(attempt.checkCount),
          });
          throw error;
        }
        // Access is a separate step: a failure here leaves the order paid with access pending and a retry job.
        if (paid.created)
          await issueGrants(paid.orderId, { actor: "job", actorId: "payment" });
        return;
      }
      case "pending":
        await fenced(attempt, {
          state: "verification_pending",
          evidence: verdict.evidence,
          lastProviderStatus: verdict.evidence.captureStatus,
          checkCount: attempt.checkCount + 1,
          nextCheckAt: backoff(attempt.checkCount),
          lastError: "capture_pending",
        });
        return;
      case "declined":
        await fenced(attempt, { evidence: verdict.evidence });
        await closeAttempt(attempt, "failed", "capture_declined", "cancelled");
        return;
      case "mismatch":
      case "no_capture":
        await holdForReview(
          attempt,
          verdict.outcome === "mismatch"
            ? verdict.failed.join(",")
            : "no_capture",
          verdict.evidence,
        );
        return;
    }
  } finally {
    await releaseLease(attempt);
  }
}

/* ---------- public operations ---------- */

async function loadScopedAttempt(
  principal: Principal,
  attemptId: string,
): Promise<AttemptRow> {
  return getStorage().payments.scopedAttempt(principal, attemptId);
}

/**
 * Checks an attempt against PayPal and moves it forward. Capture happens only
 * when `mayCapture` is true (POST from the buyer, owner action, or job), never
 * from a GET. The browser's return parameters are not inputs.
 */
export async function reconcilePayment(
  principal: Principal,
  attemptId: string,
  options: { mayCapture: boolean; signal?: AbortSignal },
): Promise<PaymentView> {
  if (principal.kind === "buyer") await assertAssistantTurn(principal);
  let attempt = await loadScopedAttempt(principal, attemptId);
  if (attempt.state === "planned" || attempt.state === "create_in_flight") {
    await driveCreate(attempt.id, options.signal);
    attempt = await loadScopedAttempt(principal, attemptId);
  }
  if (
    [
      "order_created",
      "approval_observed",
      "capture_in_flight",
      "verification_pending",
    ].includes(attempt.state)
  ) {
    await driveReconcile(
      attempt.id,
      options.mayCapture,
      options.signal,
      principal.kind === "buyer" ? principal : undefined,
    );
  }
  return getPaymentView(principal, attemptId);
}

/** The buyer abandons a checkout that has not been paid. Stock goes back on sale. */
export async function cancelCheckout(
  buyer: BuyerPrincipal,
  attemptId: string,
): Promise<PaymentView> {
  const scoped = await loadScopedAttempt(buyer, attemptId);
  if (["paid", "failed", "cancelled"].includes(scoped.state))
    return getPaymentView(buyer, attemptId);
  // Read PayPal first: if a capture already happened, it is recorded, not cancelled.
  await reconcilePayment(buyer, attemptId, { mayCapture: false });
  const attempt = await acquireLease(attemptId, [
    "planned",
    "order_created",
    "approval_observed",
  ]);
  if (attempt) {
    try {
      await closeAttempt(attempt, "cancelled", "buyer_cancelled", "cancelled");
    } finally {
      await releaseLease(attempt);
    }
  }
  return getPaymentView(buyer, attemptId);
}

/* ---------- views ---------- */

export type PaymentView = {
  attemptId: string;
  quoteId: string;
  environment: "fixture" | "sandbox";
  state: PaymentState;
  tone: "progress" | "action" | "success" | "attention" | "closed";
  headline: string;
  detail: string;
  amount: string;
  approvalUrl: string | null;
  order: { id: string; number: number } | null;
  next: string[];
};

export function describeAttempt(
  attempt: AttemptRow,
  order: { id: string; number: number } | null,
): Omit<PaymentView, "attemptId" | "quoteId" | "environment"> {
  const amount = formatMoney(attempt.amountMinor, attempt.currency);
  const uncertain = Boolean(attempt.uncertainSince);
  const base = { amount, order, approvalUrl: null as string | null };
  switch (attempt.state) {
    case "planned":
    case "create_in_flight":
      return attempt.lastError === "create_uncertain_needs_owner"
        ? {
            ...base,
            state: attempt.state,
            tone: "attention",
            headline: "The seller is checking this checkout",
            detail:
              "PayPal did not confirm that checkout started. The seller will resolve it. Do not pay again.",
            next: ["contact_seller"],
          }
        : {
            ...base,
            state: attempt.state,
            tone: "progress",
            headline: uncertain
              ? "Confirming checkout with PayPal"
              : "Starting PayPal checkout",
            detail: uncertain
              ? "PayPal has not answered yet. You have not been charged. Check again in a moment."
              : "Getting your PayPal approval link.",
            next: ["check_again"],
          };
    case "order_created":
      return {
        ...base,
        state: attempt.state,
        tone: "action",
        headline:
          attempt.lastError === "instrument_declined"
            ? "PayPal declined that payment method"
            : "Approve the payment in PayPal",
        detail:
          attempt.lastError === "instrument_declined"
            ? "Choose another way to pay in PayPal. You have not been charged."
            : `You will review ${amount} in PayPal. Nothing is charged until you approve.`,
        approvalUrl: attempt.approvalUrl,
        next: ["approve_in_paypal", "cancel_checkout"],
      };
    case "approval_observed":
    case "capture_in_flight":
      return {
        ...base,
        state: attempt.state,
        tone: "progress",
        headline: uncertain
          ? "Confirming your payment with PayPal"
          : "Completing your payment",
        detail: uncertain
          ? "PayPal has not confirmed the result yet. Do not pay again; this page checks for you."
          : "PayPal approved the payment. We are confirming it with PayPal.",
        next: ["check_again"],
      };
    case "verification_pending":
      if (attempt.lastError?.startsWith("evidence_mismatch")) {
        return {
          ...base,
          state: attempt.state,
          tone: "attention",
          headline: "Payment needs the seller's review",
          detail:
            "PayPal's record did not match this quote, so it was not accepted as paid. The seller will check it. Do not pay again.",
          next: ["contact_seller"],
        };
      }
      return {
        ...base,
        state: attempt.state,
        tone: "progress",
        headline: "Payment pending at PayPal",
        detail:
          "PayPal is still processing this payment. Your order is created when PayPal confirms it.",
        next: ["check_again"],
      };
    case "paid":
      return {
        ...base,
        state: attempt.state,
        tone: "success",
        headline: order ? `Paid. Order #${order.number}` : "Paid",
        detail: `PayPal confirmed ${amount}.`,
        next: ["view_order"],
      };
    case "failed":
      return {
        ...base,
        state: attempt.state,
        tone: "closed",
        headline:
          attempt.lastError === "capture_declined"
            ? "PayPal declined the payment"
            : "Payment did not complete",
        detail:
          "You have not been charged. Ask for a fresh quote to try again.",
        next: ["requote"],
      };
    case "cancelled":
      return {
        ...base,
        state: attempt.state,
        tone: "closed",
        headline:
          attempt.lastError === "approval_window_expired" ||
          attempt.lastError === "hold_expired_before_capture"
            ? "Checkout expired"
            : "Checkout cancelled",
        detail:
          "You have not been charged. Ask for a fresh quote to try again.",
        next: ["requote"],
      };
  }
}

export async function getPaymentView(
  principal: Principal,
  attemptId: string,
): Promise<PaymentView> {
  const attempt = await loadScopedAttempt(principal, attemptId);
  const order = await getStorage().payments.orderForAttempt(attempt.id);
  return {
    attemptId: attempt.id,
    quoteId: attempt.quoteId,
    environment: attempt.environment,
    ...describeAttempt(attempt, order ?? null),
  };
}

/** Attempts whose next check is due, for the job runner. */
export async function listDueAttempts(limit: number): Promise<string[]> {
  return getStorage().payments.dueAttempts(limit);
}
