/** Quote states in the buyer's words. Shared by the buyer interface and model context. */
export const QUOTE_STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "neutral" | "danger" }> = {
  review_ready: { label: "Ready to pay", tone: "info" },
  needs_information: { label: "Needs a change", tone: "warning" },
  seller_review: { label: "Shop is checking", tone: "warning" },
  accepted: { label: "Payment started", tone: "info" },
  consumed: { label: "Paid", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  replaced: { label: "Replaced", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** The owner's quote page title: what to do while it waits for them, otherwise what it is. */
export function ownerQuoteTitle({ status, totalMinor, hasService }: { status: string; totalMinor: number | null; hasService: boolean }): string {
  if (status === "seller_review") return totalMinor === null ? "Price this request" : "Confirm the work";
  return hasService ? "Service request" : "Quote";
}
