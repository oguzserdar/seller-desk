/**
 * Independent payment evidence. A capture is accepted as paid only when every
 * check passes against what we stored before talking to PayPal. Browser
 * returns, webhook payloads and model text are never inputs here.
 */
import { fromProviderValue } from "@/lib/money";
import type { Environment, EvidenceCheck, PaymentEvidence } from "@/server/db/types";
import type { ProviderOrder } from "@/server/paypal/types";

export type ExpectedPayment = {
  environment: Environment;
  providerOrderId: string;
  quoteId: string;
  amountMinor: number;
  currency: string;
  payeeMerchantId: string;
};

export type EvidenceVerdict =
  | { outcome: "paid"; evidence: PaymentEvidence; captureId: string }
  | { outcome: "pending"; evidence: PaymentEvidence }
  | { outcome: "declined"; evidence: PaymentEvidence }
  | { outcome: "mismatch"; evidence: PaymentEvidence; failed: string[] }
  | { outcome: "no_capture"; evidence: PaymentEvidence };

const DECLINED_CAPTURE_STATUSES = new Set(["DECLINED", "FAILED"]);

export function evaluateEvidence(order: ProviderOrder, expected: ExpectedPayment, observedAt = new Date()): EvidenceVerdict {
  const capture = order.capture;
  const captureMinor = capture?.amount ? fromProviderValue(capture.amount.value, capture.amount.currency) : null;
  const checks: EvidenceCheck[] = [
    { name: "environment", passed: order.environment === expected.environment },
    { name: "order_id", passed: order.id === expected.providerOrderId },
    { name: "reference_id", passed: order.referenceId === expected.quoteId },
    {
      name: "payee",
      passed: order.payeeMerchantId === expected.payeeMerchantId,
      detail: order.payeeMerchantId ? undefined : "PayPal did not report the payee",
    },
    {
      name: "amount",
      passed: captureMinor === expected.amountMinor && capture?.amount?.currency === expected.currency,
      detail: capture?.amount ? `${capture.amount.value} ${capture.amount.currency}` : "no captured amount",
    },
    { name: "capture_status", passed: capture?.status === "COMPLETED", detail: capture?.status ?? "no capture" },
  ];
  const evidence: PaymentEvidence = {
    observedAt: observedAt.toISOString(),
    environment: order.environment,
    providerOrderId: order.id,
    orderStatus: order.status,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
    amountValue: capture?.amount?.value ?? null,
    currency: capture?.amount?.currency ?? null,
    payeeMerchantId: order.payeeMerchantId,
    referenceId: order.referenceId,
    checks,
  };
  if (!capture) return { outcome: "no_capture", evidence };
  const identityFailures = checks.filter((check) => check.name !== "capture_status" && !check.passed).map((check) => check.name);
  if (identityFailures.length > 0) return { outcome: "mismatch", evidence, failed: identityFailures };
  if (capture.status === "COMPLETED") return { outcome: "paid", evidence, captureId: capture.id };
  if (DECLINED_CAPTURE_STATUSES.has(capture.status)) return { outcome: "declined", evidence };
  return { outcome: "pending", evidence };
}

/**
 * Checks an approved order against what we created, before any money moves.
 * Returns the names of failed checks; an empty list means capture may proceed.
 */
export function precaptureFailures(order: ProviderOrder, expected: ExpectedPayment): string[] {
  const orderMinor = order.amount ? fromProviderValue(order.amount.value, order.amount.currency) : null;
  const checks: [string, boolean][] = [
    ["environment", order.environment === expected.environment],
    ["order_id", order.id === expected.providerOrderId],
    ["reference_id", order.referenceId === expected.quoteId],
    ["payee", order.payeeMerchantId === expected.payeeMerchantId],
    ["amount", orderMinor === expected.amountMinor && order.amount?.currency === expected.currency],
  ];
  return checks.filter(([, passed]) => !passed).map(([name]) => name);
}

/** Approval links may only point at the transport's documented hosts. */
export function isAllowedApprovalUrl(url: string | null, allowedHosts: readonly string[]): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const secure = parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    return secure && allowedHosts.includes(parsed.host);
  } catch {
    return false;
  }
}
