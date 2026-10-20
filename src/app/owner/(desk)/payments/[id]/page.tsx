import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cx } from "@/lib/cx";
import { requireOwner } from "@/server/auth/owner";
import { DomainError } from "@/server/domain/errors";
import { getPaymentView, type PaymentView } from "@/server/payments/engine";
import { ReconcileButton } from "./reconcile-button";

export const metadata: Metadata = { title: "Payment check" };

/**
 * The engine words payments for the buyer ("Approve the payment in PayPal").
 * The owner reads the same states from the shop's side.
 */
function ownerWords(view: PaymentView): { headline: string; detail: string } {
  switch (view.state) {
    case "planned":
    case "create_in_flight":
      return view.tone === "attention"
        ? { headline: "PayPal did not confirm the checkout started", detail: "Check with PayPal below to settle it. The buyer was told not to pay again." }
        : { headline: "Checkout is starting", detail: "The buyer is on the way to PayPal. Nothing has been charged." };
    case "order_created":
      return { headline: "Waiting for the buyer to approve in PayPal", detail: "Nothing has been charged yet." };
    case "approval_observed":
    case "capture_in_flight":
      return { headline: "Completing the payment", detail: "The buyer approved in PayPal. Checking confirms whether the capture went through." };
    case "verification_pending":
      return view.tone === "attention"
        ? { headline: "PayPal's record did not match the quote", detail: "It was not counted as paid and nothing was handed over. Check with PayPal, then contact the buyer." }
        : { headline: "Payment pending at PayPal", detail: "The order is created when PayPal confirms it." };
    case "failed":
      return { headline: "The payment did not complete", detail: "Nothing was charged." };
    case "cancelled":
      return { headline: "Checkout cancelled", detail: "Nothing was charged." };
    default:
      return { headline: view.headline, detail: view.detail };
  }
}

export default async function OwnerPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { owner } = await requireOwner(await headers());
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let view;
  try {
    view = await getPaymentView(owner, id);
  } catch (error) {
    if (error instanceof DomainError && error.code === "not_found") notFound();
    throw error;
  }
  const words = ownerWords(view);
  return (
    <section className="w-full max-w-3xl px-4 py-8 sm:px-8">
      <Link href="/owner/orders?view=payments_uncertain" className="text-brand text-[14px] font-semibold hover:underline">
        ← Payments to check
      </Link>
      <h1 className="page-title mt-3">Payment {view.amount}</h1>
      <section className="surface mt-5 flex flex-col gap-4 p-5">
        <div>
          <p className={cx("text-[19px] font-semibold", view.tone === "attention" && "text-attention", view.tone === "success" && "text-success")}>{words.headline}</p>
          <p className="text-ink-2 mt-1">{words.detail}</p>
        </div>
        <p className="text-ink-3 text-[14px]">Checking asks PayPal for the current state of this payment and records it. It never starts a second charge.</p>
        <ReconcileButton attemptId={view.attemptId} />
      </section>
    </section>
  );
}
