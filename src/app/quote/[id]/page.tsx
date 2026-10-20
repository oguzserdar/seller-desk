import type { Metadata } from "next";
import { QuoteReview } from "./quote-review";

export const metadata: Metadata = { title: "Review and pay" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-8 pb-16">
      <QuoteReview quoteId={id} />
    </main>
  );
}
