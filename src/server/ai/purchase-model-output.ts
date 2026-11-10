/** Buyer purchase facts for model reasoning, with complete records retained by the app. */
import { ORDER_FOLLOWUP_LABEL } from "@/lib/order-followup";
import type { BuyerPurchases } from "@/server/domain/buyer-purchases";

const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
function recordedTime(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? `${time.format(date)} UTC` : "Time unavailable";
}

/** Keeps required tool handles while making payment, work and customer acceptance distinct facts. */
export function purchaseFactsForModel(output: BuyerPurchases) {
  // Saved tool evidence can predate fields the current model projection needs.
  // A new scoped read supplies those facts without changing the saved transcript.
  if (!output || !Array.isArray(output.orders) || !Array.isArray(output.otherPayments)
    || output.recordLimits?.customerAcceptance !== "not_collected"
    || output.recordLimits?.appointmentDateTime !== "not_shared"
    || output.orders.some(order => !order.help || !Array.isArray(order.help.history))) {
    return { error: "This saved purchase evidence is incomplete. Call my_orders again before drawing conclusions about payment, work or customer acceptance." };
  }
  return {
    recordLimits: {
      customerAcceptance: "No customer acceptance or satisfaction is recorded. Payment does not establish either.",
      appointmentDateTime: "The only appointment time on record is one an order's fulfillment lists as \"Agreed with the shop\". Where that line is absent, no date or time is shared.",
    },
    orders: output.orders.map(({ paidAt, help, ...order }) => ({
      ...order, paidAt: recordedTime(paidAt),
      help: {
        status: help.state === "none" ? "No customer problem reported" : ORDER_FOLLOWUP_LABEL[help.state],
        nextActor: help.nextActor,
        resolutionScope: "Any confirmation concerns only the reported problem, not acceptance of all work, a waiver or a refund.",
        history: help.history.map(({ actor, state, message, at }) => ({ actor, status: ORDER_FOLLOWUP_LABEL[state], message, at: recordedTime(at) })),
        earlierMessages: help.earlierMessages,
      },
    })),
    otherPayments: output.otherPayments.map(({ state: _state, ...payment }) => payment),
  };
}
