import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutCancelled } from "./checkout-cancelled";

export const metadata: Metadata = { title: "Checkout paused" };

export default function CheckoutCancelPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<p className="text-ink-3">Loading…</p>}>
        <CheckoutCancelled />
      </Suspense>
    </main>
  );
}
