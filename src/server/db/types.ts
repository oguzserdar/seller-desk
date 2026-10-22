/** JSON shapes stored in jsonb columns. Kept free of runtime imports so client DTOs can reuse them. */

export type OfferKind = "goods" | "service" | "digital";
export type Environment = "fixture" | "sandbox";

/** One quoted offer, frozen at the offer revision the buyer reviewed. */
export type QuoteLine = {
  offerId: string;
  offerRevision: number;
  kind: OfferKind;
  title: string;
  unitAmountMinor: number | null;
  quantity: number;
  lineTotalMinor: number | null;
  fulfillmentNote: string;
};

/** A line with a reviewed positive price, required for a paid order. */
export type PricedQuoteLine = QuoteLine & { unitAmountMinor: number; lineTotalMinor: number };

/** An explicit charge on top of the lines. Unknown charges are never guessed. */
export type QuoteCharge = {
  code: "pickup" | "service_request" | "digital_delivery";
  label: string;
  amountMinor: number;
};

export type UnresolvedCode =
  | "delivery_not_offered"
  | "scope_review_required"
  | "details_needed"
  | "policy_missing"
  | "quantity_unavailable"
  | "offer_unavailable"
  | "currency_unsupported"
  | "over_budget";

/** A reason the quote cannot go to checkout yet, in words the buyer can act on. */
export type Unresolved = {
  code: UnresolvedCode;
  message: string;
  offerId?: string;
};

/** The policy text the buyer actually reviewed, stored with the quote and order. */
export type PolicySnapshot = {
  policyRevision: number;
  sellerName: string;
  pickupPolicy: string | null;
  serviceRequestPolicy: string | null;
  digitalAccessPolicy: string | null;
  cancellationPolicy: string | null;
  taxPolicy: string | null;
};

export type OrderSnapshot = {
  quoteId: string;
  quoteThreadId: string;
  quoteRevision: number;
  lines: PricedQuoteLine[];
  charges: QuoteCharge[];
  subtotalMinor: number;
  totalMinor: number;
  currency: string;
  policy: PolicySnapshot;
  approvedScope: string | null;
  buyerNote: string | null;
};

export type EvidenceCheck = { name: string; passed: boolean; detail?: string };

/** What we independently read back from PayPal (or the fixture provider) before marking paid. */
export type PaymentEvidence = {
  observedAt: string;
  environment: Environment;
  providerOrderId: string;
  orderStatus: string;
  captureId: string | null;
  captureStatus: string | null;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
  referenceId: string | null;
  checks: EvidenceCheck[];
};

export type StoredMessagePart =
  | { type: "text"; text: string }
  | { type: `data-${string}`; id?: string; data: unknown };

export type TaskDetails = {
  /** Seller's account of delivered work, visible to this order's buyer. */
  completionNote?: string;
  /** The note recorded with "Time confirmed": the agreed time, shown to the buyer. Follow-up notes stay private. */
  confirmedTime?: string;
  /** Work can finish without a separately recorded appointment. Never implies a booking. */
  closedBecauseWorkCompleted?: boolean;
  pickupNote?: string;
  followUps?: { note: string; recordedAt: string }[];
  grantId?: string;
  lastAttemptAt?: string;
};

export type FieldEvidence = { quote: string; start: number; end: number };

/** One reviewed draft field: quoted, suggested by the model, unknown, or owner-edited. */
export type DraftField<T> = {
  value: T | null;
  evidence: FieldEvidence | null;
  status: "grounded" | "suggested" | "unknown" | "edited";
};

export type DraftOffer = {
  key: string;
  kind: DraftField<OfferKind>;
  title: DraftField<string>;
  description: DraftField<string>;
  priceMinor: DraftField<number>;
  stock: DraftField<number>;
  fulfillmentNote: DraftField<string>;
  serviceScope: DraftField<string>;
  include: boolean;
};

export type ProposalArgs = Record<string, string | number | boolean | null>;

export type ProposalResult = {
  outcome: "ok" | "failed" | "noop";
  message: string;
  observed?: Record<string, string | number | boolean | null>;
};

/** Sanitized webhook facts. No payer details are stored. */
export type WebhookSummary = {
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  status: string | null;
};

export type AuditDetails = Record<string, string | number | boolean | null>;
