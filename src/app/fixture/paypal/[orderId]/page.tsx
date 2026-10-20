import { formatMoney } from "@/lib/money";
import { readDemoPayment } from "@/server/domain/fixture-payment";
import { getSeller } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Demo PayPal approval" };

/** Stands in for PayPal's approval screen in fixture mode only; it says so, and moves no money. */
export default async function FixturePayPalPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  if (getServerConfig().mode !== "fixture") notFound();
  const { orderId } = await params;
  const [order, shop] = await Promise.all([
    readDemoPayment(orderId),
    getSeller(),
  ]);
  if (!order) notFound();
  const waiting = order.status === "PAYER_ACTION_REQUIRED";
  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-col px-4 pt-10 pb-16">
      <span className="bg-fixture-soft text-fixture self-start rounded-full px-3 py-1 text-[13px] font-semibold">
        Demo PayPal
      </span>
      <h1 className="mt-4 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
        Pay {shop?.displayName ?? "the shop"}
      </h1>
      <p className="tabular mt-2 text-[40px] leading-none font-semibold tracking-[-0.02em]">
        {formatMoney(order.amountMinor, order.currency)}{" "}
        <span className="text-ink-3 text-[16px] font-medium tracking-normal">
          {order.currency}
        </span>
      </p>
      <p className="text-ink-2 mt-4 text-[15px]">
        This page stands in for PayPal in the demo. No PayPal account is used
        and no real money moves.
      </p>
      {waiting ? (
        <form
          method="post"
          action={`/api/fixture/paypal/${order.id}`}
          className="mt-7 flex flex-col gap-2.5"
        >
          <button
            name="decision"
            value="approve"
            className="bg-brand hover:bg-brand-strong min-h-12 rounded-[var(--radius-control)] px-4 text-[16px] font-semibold text-white transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            Approve payment
          </button>
          <button
            name="decision"
            value="cancel"
            className="text-ink-2 hover:bg-sunken hover:text-ink min-h-12 rounded-[var(--radius-control)] px-4 text-[15px] font-semibold transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            Cancel and go back to the shop
          </button>
        </form>
      ) : (
        <p className="text-ink-2 mt-7">
          This payment was already{" "}
          {order.status === "APPROVED" ? "approved" : "handled"}.{" "}
          <a
            className="text-brand font-semibold hover:underline"
            href={`${order.returnUrl}&token=${encodeURIComponent(order.id)}`}
          >
            Return to the shop
          </a>
        </p>
      )}
      <details className="text-ink-2 mt-8 text-[14px]">
        <summary className="hover:text-ink cursor-pointer font-medium select-none">
          What the shop&apos;s server sees
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-3">PayPal order</dt>
          <dd className="font-mono text-[13px]">{order.id}</dd>
          <dt className="text-ink-3">Status</dt>
          <dd className="font-mono text-[13px]">{order.status}</dd>
          <dt className="text-ink-3">Payee</dt>
          <dd className="font-mono text-[13px]">{order.payeeMerchantId}</dd>
        </dl>
        <p className="text-ink-3 mt-3 text-[13px]">
          The shop counts the payment only after its server reads the captured
          PayPal record and these details match.
        </p>
      </details>
    </main>
  );
}
