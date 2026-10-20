/** Payment evidence for model reasoning; stored tool results remain unchanged. */
type PaymentCheck = {
  verified: boolean; checkType: "stored_record" | "reconciliation_attempt";
  environment: "fixture" | "sandbox"; status: string; detail: string; amount: string;
  order: { number: number } | null;
};

/** Explains evidence provenance without handing raw status codes to the model as customer wording. */
export function paymentFactsForModel(output: PaymentCheck | { error: string }) {
  if ("error" in output) return output;
  return {
    paymentConfirmed: output.verified,
    paymentEnvironment: output.environment === "sandbox" ? "PayPal sandbox transaction; test money only" : "Simulated test payment; no real money",
    evidence: output.checkType === "stored_record"
      ? "Saved shop record. PayPal was not contacted during this check."
      : "Reconciliation was attempted for this existing payment. This result may still be pending; it is not permission to start another payment.",
    status: output.status, detail: output.detail, amount: output.amount, orderNumber: output.order?.number ?? null,
  };
}
