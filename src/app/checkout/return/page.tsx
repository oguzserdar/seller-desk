import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutReturn } from "./checkout-return";

export const metadata: Metadata = { title: "Confirming payment" };

/**
 * PayPal sends the buyer here after approval. Loading this page changes
 * nothing; the client then asks the server (POST) to verify and capture.
 */
export default function CheckoutReturnPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<p className="text-ink-3">Loading…</p>}>
        <CheckoutReturn />
      </Suspense>
    </main>
  );
}
