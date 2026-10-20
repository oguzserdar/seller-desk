/** Shared display rules. Storage implementations supply native rows; no SQL or provider calls here. */
import { formatMoney, formatQuoteAmount } from "@/lib/money";
import type {
  fulfillmentTask,
  orderFollowup,
  orders,
  paymentAttempt,
  quote,
} from "@/server/db/schema";
import { getServerConfig } from "@/server/env";
import type { DeskRow } from "./desk";
import type { AccessBlock } from "./digital";
import { describeTask, ownerStep } from "./orders";
import { effectiveStatus } from "./quotes";
function summarizeItems(lines: { title: string; quantity: number }[]): string {
  return lines
    .map((line) =>
      line.quantity > 1 ? `${line.quantity} × ${line.title}` : line.title,
    )
    .join(", ");
}

const PAYMENT_LABEL: Record<string, string> = {
  planned: "Starting checkout",
  create_in_flight: "Confirming checkout with PayPal",
  order_created: "Waiting for buyer approval",
  approval_observed: "Approved, completing payment",
  capture_in_flight: "Confirming capture with PayPal",
  verification_pending: "Verification pending",
};

/** Projects actual fulfillment, payment and customer-feedback facts into seller rows. */
export function projectOrders(
  rows: (typeof orders.$inferSelect)[],
  tasks: (typeof fulfillmentTask.$inferSelect)[],
  followups: (typeof orderFollowup.$inferSelect)[],
  accessBlocks: Map<string, AccessBlock>,
): DeskRow[] {
  const followupByOrder = new Map(followups.map((row) => [row.orderId, row]));
  return rows.map((row) => {
    const own = tasks
      .filter((task) => task.orderId === row.id)
      .map((task) => {
        const blocked =
          task.type === "digital_access" &&
          task.state !== "completed" &&
          accessBlocks.has(row.id);
        return {
          id: task.id,
          type: task.type,
          state: blocked ? ("attention" as const) : task.state,
          revision: task.revision,
          ...describeTask(task),
          ...(blocked
            ? {
                label: "Download needs seller review",
                tone: "attention" as const,
              }
            : {}),
          step: blocked ? "Review download access" : ownerStep(task),
        };
      });
    const open = own.filter((task) => task.state !== "completed");
    const attention = open.find((task) => task.state === "attention");
    const followup = followupByOrder.get(row.id);
    const customerNeedsHelp = followup?.state === "needs_help";
    const nextStep = customerNeedsHelp
      ? "Reply to the customer's problem"
      : (attention?.step ??
        open[0]?.step ??
        (followup?.state === "awaiting_customer"
          ? "Waiting for customer confirmation"
          : followup?.state === "confirmed"
            ? "Customer confirmed their problem is resolved"
            : "Fulfilled; no customer feedback"));
    return {
      kind: "order" as const,
      id: row.id,
      ref: `#${row.number}`,
      when: row.paidAt.toISOString(),
      who: row.buyerName ?? "Buyer",
      items: summarizeItems(row.snapshot.lines),
      offerKinds: [...new Set(row.snapshot.lines.map((line) => line.kind))],
      firstOfferId: row.snapshot.lines[0]?.offerId ?? null,
      imagePath: null,
      totalMinor: row.totalMinor,
      currency: row.currency,
      amount: formatQuoteAmount(row.totalMinor, row.currency),
      status: "Paid",
      nextStep,
      ...(accessBlocks.has(row.id)
        ? {
            accessReview: `${accessBlocks.get(row.id)!.reason} Retrying cannot renew or reinstate access. Review the purchased access terms with the buyer.`,
          }
        : {}),
      tone:
        attention || customerNeedsHelp
          ? ("attention" as const)
          : open.length > 0 || followup?.state === "awaiting_customer"
            ? ("action" as const)
            : ("success" as const),
      needsOwner: open.length > 0 || customerNeedsHelp,
      environment: row.environment,
      tasks: own,
      href: `/owner/orders/${row.id}`,
    };
  });
}
/** Projects uncertain provider outcomes without calling them paid. */
export function projectPayments(
  rows: {
    attempt: typeof paymentAttempt.$inferSelect;
    lines: (typeof quote.$inferSelect)["lines"];
  }[],
): DeskRow[] {
  return rows.map(({ attempt, lines }) => {
    const mismatch =
      attempt.lastError?.startsWith("evidence_mismatch") ?? false;
    return {
      kind: "payment" as const,
      id: attempt.id,
      ref: attempt.providerOrderId ?? "PayPal order pending",
      when: attempt.updatedAt.toISOString(),
      who: "Buyer",
      items: summarizeItems(lines),
      offerKinds: [...new Set(lines.map((line) => line.kind))],
      firstOfferId: lines[0]?.offerId ?? null,
      imagePath: null,
      totalMinor: attempt.amountMinor,
      currency: attempt.currency,
      amount: formatMoney(attempt.amountMinor, attempt.currency),
      status: PAYMENT_LABEL[attempt.state] ?? attempt.state,
      nextStep: mismatch
        ? "PayPal record does not match; review before fulfilling"
        : "Check with PayPal again",
      tone: "attention" as const,
      needsOwner: true,
      environment: attempt.environment,
      tasks: [],
      href: `/owner/payments/${attempt.id}`,
    };
  });
}
/** Projects only unexpired requests awaiting the seller's decision. */
export function projectQuotes(rows: (typeof quote.$inferSelect)[]): DeskRow[] {
  return rows
    .filter((row) => effectiveStatus(row) === "seller_review")
    .map((row) => ({
      kind: "quote" as const,
      id: row.id,
      // The revision lives on the quote page; on the desk it only crowds the column.
      ref: "Quote",
      when: row.createdAt.toISOString(),
      who: "Buyer",
      items: summarizeItems(row.lines),
      offerKinds: [...new Set(row.lines.map((line) => line.kind))],
      firstOfferId: row.lines[0]?.offerId ?? null,
      imagePath: null,
      totalMinor: row.totalMinor,
      currency: row.currency,
      amount:
        row.totalMinor === null
          ? "To price"
          : formatQuoteAmount(row.totalMinor, row.currency),
      status: "Waiting for your review",
      nextStep:
        row.totalMinor === null
          ? "Set the price and confirm the work"
          : "Confirm the service scope or decline",
      tone: "attention" as const,
      needsOwner: true,
      environment: getServerConfig().mode,
      tasks: [],
      href: `/owner/quotes/${row.id}`,
    }));
}
