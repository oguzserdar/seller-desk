"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/arc/button/button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import type { GuideInput } from "@/lib/shop-guide";
import { guideHistoryAction, restoreGuideAction } from "./actions";

/** Owner-only history: restoration makes a new draft and leaves original snapshots intact. */
export function KnowledgeHistory({ entry, products, onClose, onRestored }: { entry: GuideInput; products: { id: string; title: string }[]; onClose: () => void; onRestored: () => void }) {
  const router = useRouter();
  const { execute, result, isPending } = useAction(guideHistoryAction);
  const restore = useAction(restoreGuideAction, { onSuccess: () => { router.refresh(); onRestored(); } });
  useEffect(() => { if (entry.id) execute({ id: entry.id }); }, [entry.id, execute]);
  const error = result.serverError ?? restore.result.serverError;
  return <section aria-label={`Version history of ${entry.title}`} className="border-line mt-6 border-t pt-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[22px] font-semibold">History of {entry.title}</h2><Button variant="ghost" onClick={onClose}>Close history</Button></div>
    <p className="text-ink-2 mt-2 text-[14px] leading-relaxed">Restore a version to review it as a new draft. This stops the current published version; customers get the restored facts only after you publish them.</p>
    {error ? <Alert className="mt-4" tone="danger" title={error} /> : null}
    {isPending ? <p role="status" className="text-ink-2 mt-4">Loading saved versions…</p> : null}
    <ol className="divide-line mt-4 divide-y">{result.data?.versions.map(version => <li key={version.revision} className="py-5">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-[16px] font-semibold">Version {version.revision}</h3><Badge>{version.snapshot.archived ? "Removed" : version.snapshot.published ? "Published at the time" : "Draft"}</Badge>{version.revision === entry.expectedRevision ? <span className="text-ink-3 text-[13px]">Current version</span> : null}</div>
      <p className="text-ink-2 mt-2 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{version.snapshot.body}</p>
      <p className="text-ink-3 mt-2 text-[13px]">{version.snapshot.productId ? products.find(product => product.id === version.snapshot.productId)?.title ?? "Selected product" : "Whole shop"}{version.snapshot.validUntil ? ` · Expiry: ${version.snapshot.validUntil}` : " · No expiry"}</p>
      <p className="text-ink-3 mt-1 text-[12px]">Saved {version.savedAt.replace("T", " ").slice(0, 19)} UTC</p>
      {version.revision !== entry.expectedRevision || version.snapshot.archived ? <Button variant="secondary" className="mt-3" disabled={restore.isPending} onClick={() => restore.execute({ id: entry.id!, expectedRevision: entry.expectedRevision!, restoreRevision: version.revision })}>Restore version {version.revision} as draft</Button> : null}
    </li>)}</ol>
  </section>;
}
