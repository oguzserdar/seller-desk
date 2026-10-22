"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PaymentStatus } from "@/components/buyer/payment-status";
import { LinkButton } from "@/components/link-button";
import { Alert } from "@/components/arc/alert/alert";
import { api, readToken } from "@/lib/buyer-client";
import type { PaymentView } from "@/server/payments/engine";

/** The buyer left PayPal without approving. Nothing is charged; they can return or cancel. */
export function CheckoutCancelled() {
  const params = useSearchParams();
  const attemptId = params.get("attempt");
  const [view, setView] = useState<PaymentView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptId || !/^[0-9a-f-]{36}$/i.test(attemptId) || !readToken()) {
      setProblem("Open your quote from the shop to see its status.");
      return;
    }
    void api<PaymentView>(`/api/buyer/payment/${attemptId}`).then((result) => {
      if (result.data) setView(result.data);
      else setProblem(result.message);
    });
  }, [attemptId]);

  // Once the checkout is closed, the choices below no longer exist and PaymentStatus links back to the shop itself.
  const open = !view || view.next.includes("approve_in_paypal") || view.next.includes("cancel_checkout");
  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">You left PayPal before paying</h1>
      {open ? <p className="text-ink-2">You have not been charged. You can go back to PayPal, or cancel this checkout so the items return to the shop.</p> : null}
      {problem ? <Alert tone="warning" title={problem} /> : null}
      {view ? <PaymentStatus view={view} onChange={setView} /> : null}
      {view?.next.includes("requote") ? null : (
        <LinkButton href="/buy" variant="secondary" className="self-start">
          Back to the shop
        </LinkButton>
      )}
    </div>
  );
}
