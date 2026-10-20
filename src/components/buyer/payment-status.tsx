"use client";

import { useState } from "react";
import { api } from "@/lib/buyer-client";
import type { PaymentView } from "@/server/payments/engine";
import { Button } from "@/components/arc/button/button";
import { LinkButton } from "@/components/link-button";
import { cx } from "@/lib/cx";
import { Alert } from "@/components/arc/alert/alert";

const HEADLINE_TONE: Record<PaymentView["tone"], string> = {
  progress: "text-ink",
  action: "text-ink",
  success: "text-success",
  attention: "text-attention",
  closed: "text-ink-2",
};

/** Shows the server's own words for a payment and only the actions it allows next. */
export function PaymentStatus({
  view,
  onChange,
  orderHref,
}: {
  view: PaymentView;
  onChange: (next: PaymentView) => void;
  orderHref?: string | null;
}) {
  const [busy, setBusy] = useState<"check" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const call = async (path: string, kind: "check" | "cancel") => {
    setBusy(kind);
    setMessage(null);
    const result = await api<PaymentView>(path, { method: "POST", json: { attemptId: view.attemptId } });
    setBusy(null);
    if (result.data) onChange(result.data);
    else setMessage(result.message);
  };

  return (
    <section className="surface p-5">
      <div role="status" aria-live="polite">
        <p className={cx("text-[19px] font-semibold", HEADLINE_TONE[view.tone])}>{view.headline}</p>
        <p className="text-ink-2 mt-1 text-[15px]">{view.detail}</p>
        {view.environment === "fixture" ? <p className="text-ink-3 mt-2 text-[13px]">Demo payment: no real money moved.</p> : null}
      </div>
      {message ? <Alert tone="danger" className="mt-3" title={message} /> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {view.next.includes("approve_in_paypal") && view.approvalUrl ? (
          <LinkButton href={view.approvalUrl}>{view.environment === "fixture" ? "Approve in demo PayPal" : "Approve in PayPal"}</LinkButton>
        ) : null}
        {view.next.includes("check_again") ? (
          <Button variant="secondary" onClick={() => void call("/api/buyer/reconcile", "check")} loading={busy === "check"}>
            Check again
          </Button>
        ) : null}
        {view.next.includes("cancel_checkout") ? (
          <Button variant="ghost" onClick={() => void call("/api/buyer/checkout/cancel", "cancel")} loading={busy === "cancel"}>
            Cancel this checkout
          </Button>
        ) : null}
        {view.next.includes("view_order") && orderHref ? <LinkButton href={orderHref}>View your order</LinkButton> : null}
        {view.next.includes("requote") ? (
          <LinkButton variant="secondary" href="/buy">
            Back to the shop
          </LinkButton>
        ) : null}
      </div>
    </section>
  );
}
