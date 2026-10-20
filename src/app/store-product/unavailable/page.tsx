import Link from "next/link";

/** Recovery when a historical product link is withdrawn, changed or temporarily unreachable. */
export default function StoreProductUnavailable() {
  return <main className="mx-auto max-w-lg px-6 py-16">
    <h1 className="text-[26px] font-semibold">This product could not be checked</h1>
    <p className="text-ink-2 mt-3 leading-relaxed">The shop may be unavailable, or the product or store connection may have changed. Ask the assistant to check again. Nothing was ordered or charged.</p>
    <Link href="/buy" className="text-brand mt-6 inline-block font-semibold hover:underline">Back to the shop assistant</Link>
  </main>;
}
