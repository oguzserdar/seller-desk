"use client";

import { CircleCheck } from "lucide-react";
import { BuyerOrderLink } from "./buyer-order-link";

/** Saved payment tool evidence. Earlier messages may not record provenance. */
export type PaymentResultEvidence = {
  error?: string;
  verified?: boolean;
  environment?: "fixture" | "sandbox";
  checkType?: "stored_record" | "reconciliation_attempt";
  status?: string;
  detail?: string;
  amount?: string;
  order?: { id: string; number: number } | null;
};

/** Displays actual payment evidence separately from the model's own reply. */
export function PaymentResult({ evidence: out, widget }: { evidence: PaymentResultEvidence; widget: boolean }) {
  if (out.error) return <p className="assistant-receipt">{out.error}</p>;
  const environment = out.environment === "sandbox" ? "PayPal sandbox · Test money only"
    : out.environment === "fixture" ? "Simulated payment · No real money moved" : null;
  if (!out.verified) return (
    <div className="enter bg-surface border-line rounded-[14px] border px-4 py-3">
      <p className="text-[16px] font-semibold">{out.status ?? "Payment result unavailable"}</p>
      {out.detail ? <p className="text-ink-2 text-[14px]">{out.detail}</p> : null}
      {environment ? <p className="text-ink-3 mt-2 text-[12px]">{environment}</p> : null}
    </div>
  );
  const title = out.environment === "fixture" ? "Simulated payment confirmed"
    : out.checkType === "stored_record" ? "Saved payment confirmation"
      : out.environment === "sandbox" && out.checkType === "reconciliation_attempt" ? "Payment confirmed"
        : "Payment confirmation recorded";
  return (
    <div className="enter bg-success-soft flex items-start gap-3 rounded-[14px] px-4 py-3">
      <CircleCheck aria-hidden className="text-success mt-0.5 shrink-0" size={20} strokeWidth={2} />
      <div className="min-w-0">
        <p className="text-[16px] font-semibold">{title}{out.amount ? `, ${out.amount}` : ""}</p>
        <p className="text-ink-2 mt-1 text-[14px]">{out.order ? `Order #${out.order.number}. ` : ""}No need to pay again.</p>
        {out.order ? <BuyerOrderLink orderId={out.order.id} widget={widget}>View my order</BuyerOrderLink> : null}
        {environment ? <p className="text-ink-3 mt-1 text-[12px]">{environment}</p> : null}
      </div>
    </div>
  );
}
