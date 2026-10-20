/** Shared business vocabularies; no database driver is imported here. */
export const OFFER_KINDS = ["goods", "service", "digital"] as const;
export const QUOTE_STATUSES = [
  "needs_information",
  "seller_review",
  "review_ready",
  "accepted",
  "consumed",
  "expired",
  "replaced",
  "cancelled",
] as const;
export const PAYMENT_STATES = [
  "planned",
  "create_in_flight",
  "order_created",
  "approval_observed",
  "capture_in_flight",
  "verification_pending",
  "paid",
  "failed",
  "cancelled",
] as const;
export const RESERVATION_STATES = [
  "held",
  "captured",
  "released",
  "attention",
] as const;
export const TASK_TYPES = [
  "pickup",
  "service_followup",
  "service_work",
  "digital_access",
] as const;
export const TASK_STATES = [
  "pending",
  "in_progress",
  "completed",
  "attention",
] as const;
export const ENVIRONMENTS = ["fixture", "sandbox"] as const;

/** States of a seller clarification and its conversation resume. */
export const SELLER_QUESTION_STATES = [
  "open",
  "answered",
  "resumed",
  "closed",
] as const;
