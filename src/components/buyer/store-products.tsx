import { ArrowUpRight } from "lucide-react";
import { storeProductHref, type StoreResult } from "@/lib/connected-store";

/** Original compact product rows from the live store tool, with a rechecked destination. */
export function StoreProducts({ result }: { result: StoreResult }) {
  if (result.status !== "ok") return <p role="status" className="assistant-receipt">{result.status === "disconnected" ? "No existing store connected" : "The store could not be checked. Prices and availability are unverified."}</p>;
  return <section aria-label="Products from the connected store" className="min-w-0">
    <p className="assistant-receipt">Checked {result.host} · {result.checkedAt ? new Date(result.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "this turn"}</p>
    {!result.products.length ? <p className="text-ink-2 mt-2 text-[14px]">No products matched this search.</p> : <ul className="divide-line mt-2 divide-y border-y border-line">
      {result.products.map((product) => <li key={product.id} className="py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[16px] font-semibold">{product.title}</h3>
          <p className="text-[15px] font-medium">{product.price}</p>
        </div>
        <p className="text-ink-2 mt-1 text-[14px] leading-relaxed">{product.description.slice(0, 240)}</p>
        <p className="text-ink-3 mt-2 text-[13px]">{product.inStock ? "In stock when checked" : "Out of stock when checked"}{product.hasOptions ? " · Choose options in the shop" : ""}{!product.purchasable ? " · Not currently purchasable" : ""}</p>
        {result.connection ? <a href={storeProductHref(result.connection, product.id)} target="_blank" rel="noopener noreferrer" className="text-brand mt-3 inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
          View in the shop <ArrowUpRight size={16} aria-hidden />
        </a> : null}
      </li>)}
    </ul>}
    <p className="text-ink-3 mt-2 text-[12px]">{result.hasMore ? "More results are available. " : ""}Final options, shipping and total are confirmed in the shop.</p>
  </section>;
}
