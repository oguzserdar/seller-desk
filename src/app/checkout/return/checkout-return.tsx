"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PaymentStatus } from "@/components/buyer/payment-status";
import { LinkButton } from "@/components/link-button";
import { Alert } from "@/components/arc/alert/alert";
import { api, readToken } from "@/lib/buyer-client";
import type { PaymentView } from "@/server/payments/engine";

const AUTO_CHECKS = 4;
const CHECK_INTERVAL_MS = 3000;

export function CheckoutReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const attemptId = params.get("attempt");
  const [view, setView] = useState<PaymentView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!attemptId || !/^[0-9a-f-]{36}$/i.test(attemptId)) {
      setProblem("This return link is incomplete. Open your quote from the shop to see its payment status.");
      return;
    }
    if (!readToken()) {
      setProblem("Finish checkout in the browser tab where you started it. If that tab is closed, ask the seller for your order status; you are not charged twice.");
      return;
    }
    void (async () => {
      for (let i = 0; i <= AUTO_CHECKS; i += 1) {
        const result = await api<PaymentView>("/api/buyer/capture", { method: "POST", json: { attemptId } });
        if (!result.data) {
          setProblem(result.message);
          return;
        }
        setView(result.data);
        if (result.data.tone !== "progress") return;
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
      }
    })();
  }, [attemptId]);

  // A verified payment needs no extra click: go straight to the order.
  useEffect(() => {
    if (view?.state !== "paid" || !view.order) return;
    setOrderId(view.order.id);
    router.replace(`/order/${view.order.id}`);
  }, [router, view]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="page-title">{view?.state === "paid" ? "Payment confirmed" : "Confirming your payment"}</h1>
      {problem ? (
        <>
          <Alert tone="warning" title={problem} />
          <LinkButton href="/buy" variant="secondary" className="self-start">
            Back to the shop
          </LinkButton>
        </>
      ) : view ? (
        <PaymentStatus view={view} onChange={setView} orderHref={orderId ? `/order/${orderId}` : null} />
      ) : (
        <p role="status" className="text-ink-2 text-[17px]">
          PayPal is confirming it now. This takes a few seconds, so please do not pay again.
        </p>
      )}
    </div>
  );
}
