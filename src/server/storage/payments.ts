import type { paymentAttempt, quote, reservation } from "@/server/db/schema";
import type { PaymentEvidence } from "@/server/db/types";
import type { BuyerPrincipal, Principal } from "@/server/domain/principal";

/** Identical logical payment and quote records across native dialect schemas. */
export type PaymentAttemptRow = typeof paymentAttempt.$inferSelect;
/** Server-priced quote record; callers cannot supply replacement commercial fields. */
export type PaymentQuoteRow = typeof quote.$inferSelect;
/** State-machine updates from the trusted payment driver, guarded by its fence. */
export type PaymentPatch = Partial<
  Pick<
    PaymentAttemptRow,
    | "state"
    | "lastError"
    | "nextCheckAt"
    | "uncertainSince"
    | "checkCount"
    | "lastProviderStatus"
    | "evidence"
    | "providerOrderId"
    | "approvalUrl"
    | "captureRequestHash"
  >
>;
/** Verified evidence and the exact executor allowed to commit it. */
export type PaidCommitInput = {
  attemptId: string;
  expectedFence: number;
  captureId: string;
  evidence: PaymentEvidence;
  payer: { name: string | null; email: string | null };
};
/** A durable order join is distinct from a newly committed order. */
export type PaidOutcome = {
  orderId: string;
  orderNumber: number;
  created: boolean;
};
/** Whole payment storage operations; provider requests remain in the shared driver. */
export type PaymentStorage = {
  acquireLease: (
    attemptId: string,
    states: PaymentAttemptRow["state"][],
  ) => Promise<PaymentAttemptRow | null>;
  fencedPatch: (
    attempt: PaymentAttemptRow,
    patch: PaymentPatch,
  ) => Promise<boolean>;
  releaseLease: (attempt: PaymentAttemptRow) => Promise<void>;
  closeAttempt: (
    attempt: PaymentAttemptRow,
    state: "failed" | "cancelled",
    reason: string,
    quoteStatus: "cancelled" | "expired",
  ) => Promise<void>;
  dispatchCapture: (
    attempt: PaymentAttemptRow,
    patch: PaymentPatch,
    assistant?: BuyerPrincipal,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  holdForReview: (
    attempt: PaymentAttemptRow,
    reason: string,
    evidence?: PaymentEvidence,
  ) => Promise<void>;
  recordPaidOrder: (input: PaidCommitInput) => Promise<PaidOutcome>;
  scopedAttempt: (
    principal: Principal,
    id: string,
  ) => Promise<PaymentAttemptRow>;
  getQuote: (id: string) => Promise<PaymentQuoteRow | undefined>;
  buyerGoods: (buyer: BuyerPrincipal, quoteId: string) => Promise<string[]>;
  staleHoldAttempts: (offerIds: string[], limit: number) => Promise<string[]>;
  reservations: (
    quoteId: string,
  ) => Promise<Pick<typeof reservation.$inferSelect, "state" | "expiresAt">[]>;
  orderForAttempt: (
    attemptId: string,
  ) => Promise<{ id: string; number: number } | null>;
  dueAttempts: (limit: number) => Promise<string[]>;
};
