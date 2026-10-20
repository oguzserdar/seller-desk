import { ArrowUpRight } from "lucide-react";
import { GUIDE_LABELS, type GuideSource, type ShopStep } from "@/lib/shop-guide";

/** Shows the public sources actually read, with timestamps, rather than invented citations. */
export function KnowledgeSources({ sources }: { sources: GuideSource[] }) {
  if (!sources.length) return null;
  return <details className="text-ink-2 text-[13px]">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">Read {sources.length} shop {sources.length === 1 ? "note" : "notes"}</summary>
    <ul className="border-line ml-1 space-y-4 border-l pl-4 pb-2">{sources.map((source) => <li key={source.id}>
      <p className="font-semibold">{source.title}</p><p className="text-ink-3 mt-0.5 text-[12px]">{GUIDE_LABELS[source.topic]} · Version {source.revision} · Updated {source.updatedAt.slice(0, 10)}</p>
      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{source.body}</p>
    </li>)}</ul>
  </details>;
}

/** A server-selected destination. Opens the approved page without claiming an external action completed. */
export function ShopNextStep({ step }: { step: ShopStep }) {
  return <div className="border-line border-y py-4">
    <p className="text-ink-3 text-[12px] font-medium">Continue with the shop</p>
    <p className="mt-1 text-[17px] font-semibold [overflow-wrap:anywhere]">{step.title}</p>
    <a href={`/shop-step/${encodeURIComponent(step.id)}?revision=${step.revision}`} target="_top" rel="noreferrer" className="text-brand mt-2 inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold hover:underline">
      {step.label}<ArrowUpRight size={18} aria-hidden />
    </a>
    <p className="text-ink-3 text-[12px] [overflow-wrap:anywhere]">Opens {step.host}. You review and complete the next step there.</p>
  </div>;
}
