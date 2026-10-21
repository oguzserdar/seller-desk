/**
 * Where a purchase stands, in the customer's words, read only from records the
 * buyer page already has. Requested, priced, paid and the next obligation are
 * separate facts: a price is not a booking, and a payment is not finished work.
 * After payment, each next step follows the order's own fulfilment task.
 * Nothing here claims a step that the records do not show.
 */
import type { OfferKind, PolicySnapshot, QuoteLine } from "@/server/db/types";

export type PurchaseStepState = "done" | "waiting" | "attention" | "todo" | "stopped";
export type PurchaseStep = { key: string; label: string; detail: string | null; state: PurchaseStepState; value: string | null };

type Task = { type: string; state: string };

/** The quote fields the steps depend on. */
export type PurchaseStepsInput = {
  status: string;
  lines: Pick<QuoteLine, "kind" | "title" | "fulfillmentNote">[];
  totalMinor: number | null;
  currency: string;
  approvedScope: string | null;
  policy: Pick<PolicySnapshot, "pickupPolicy" | "serviceRequestPolicy" | "digitalAccessPolicy">;
  payment: { state: string } | null;
  order: { number: number; tasks?: Task[] } | null;
};

const STOPPED: Record<string, string> = { expired: "Quote expired", cancelled: "Quote cancelled", replaced: "Replaced by a newer quote" };
const KIND_ORDER: OfferKind[] = ["service", "goods", "digital"];

/** Before payment: the shop's next obligation per kind, from its own terms or the offer's note. */
const PROMISE: Record<OfferKind, { label: string; policy: keyof PurchaseStepsInput["policy"] }> = {
  service: { label: "Timing to agree", policy: "serviceRequestPolicy" },
  goods: { label: "Pickup", policy: "pickupPolicy" },
  digital: { label: "Download from your order", policy: "digitalAccessPolicy" },
};

/** After payment: each fulfilment task in words, by its recorded state. */
const TASK_STEP: Record<string, { kind: OfferKind; done: string; open: string; attention: string }> = {
  service_followup: { kind: "service", done: "Time agreed", open: "Timing to agree", attention: "Timing needs the shop" },
  service_work: { kind: "service", done: "Work finished", open: "Work still to finish", attention: "Work needs the shop" },
  pickup: { kind: "goods", done: "Picked up", open: "Pickup", attention: "Pickup needs the shop" },
  digital_access: { kind: "digital", done: "Download ready", open: "Preparing your download", attention: "Download needs a retry" },
};

export function purchaseSteps(quote: PurchaseStepsInput): PurchaseStep[] {
  const paid = quote.order !== null;
  const titles = quote.lines.map((line) => line.title).join(", ");
  const steps: PurchaseStep[] = [{ key: "request", label: "Request sent", detail: titles || null, state: "done", value: null }];

  if (STOPPED[quote.status]) {
    steps.push({ key: "priced", label: STOPPED[quote.status]!, detail: null, state: "stopped", value: null });
    return steps;
  }
  const priced = ["review_ready", "accepted", "consumed"].includes(quote.status) && quote.totalMinor !== null;
  steps.push(
    priced
      ? { key: "priced", label: quote.approvedScope ? "Priced by the shop" : "Priced", detail: quote.approvedScope ? "Work and price confirmed" : null, state: "done", value: null }
      : quote.status === "needs_information"
        ? { key: "priced", label: "Needs a change", detail: "Something in the request has to change before it can be priced", state: "stopped", value: null }
        : { key: "priced", label: "Shop is checking", detail: "The shop prices the work first", state: "waiting", value: null },
  );

  steps.push(
    paid
      ? { key: "paid", label: "Paid with PayPal", detail: "PayPal confirmed the payment", state: "done", value: `#${quote.order!.number}` }
      : quote.payment
        ? { key: "paid", label: "Confirming payment", detail: "Waiting for PayPal to confirm. Do not pay again.", state: "waiting", value: null }
        : { key: "paid", label: "Not paid yet", detail: null, state: "todo", value: null },
  );

  const kinds = [...new Set(quote.lines.map((line) => line.kind))].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  const termsFor = (kind: OfferKind) => (quote.policy[PROMISE[kind].policy] ?? quote.lines.find((line) => line.kind === kind)?.fulfillmentNote ?? null)?.trim() || null;
  const tasks = quote.order?.tasks ?? [];
  for (const kind of kinds) {
    const own = tasks.filter((task) => TASK_STEP[task.type]?.kind === kind);
    if (!paid || own.length === 0) {
      steps.push({ key: `next-${kind}`, label: PROMISE[kind].label, detail: termsFor(kind), state: paid ? "waiting" : "todo", value: null });
      continue;
    }
    for (const task of own) {
      const words = TASK_STEP[task.type]!;
      const state: PurchaseStepState = task.state === "completed" ? "done" : task.state === "attention" ? "attention" : "waiting";
      steps.push({
        key: `task-${task.type}`,
        label: state === "done" ? words.done : state === "attention" ? words.attention : words.open,
        detail: state === "waiting" ? termsFor(kind) : null,
        state,
        value: null,
      });
    }
  }
  return steps;
}
