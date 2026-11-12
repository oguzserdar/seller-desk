import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { LinkButton } from "@/components/link-button";
import { requireOwner } from "@/server/auth/owner";
import { listOwnerGuide } from "@/server/domain/shop-guide";
import { listOwnerOffers } from "@/server/domain/offers";
import { guideSnapshot } from "@/server/domain/shop-guide";
import { KnowledgeEditor } from "./knowledge-editor";

export const metadata: Metadata = { title: "Shop knowledge" };

/** Public knowledge the owner approves for buyer conversations. */
export default async function KnowledgePage() {
  const { owner, viewer } = await requireOwner(await headers());
  const [entries, offers] = await Promise.all([listOwnerGuide(owner, true), listOwnerOffers(owner)]);
  const toInput = (entry: (typeof entries)[number]) => {
    const { archived: _archived, ...value } = guideSnapshot(entry);
    return { ...value, id: entry.id, expectedRevision: entry.revision };
  };
  return <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
    <h1 className="page-title">What your assistant knows</h1>
    <p className="text-ink-2 mt-2 max-w-2xl text-[16px] leading-relaxed">Your shipping rules, sizing advice, booking process and aftercare. Write the facts once. The assistant uses them to help each customer.</p>
    <div className="mt-5 flex flex-wrap gap-3">{viewer ? null : <><LinkButton href="/owner/knowledge/reviews" variant="secondary">Review your answers</LinkButton><LinkButton href="/owner/knowledge/tests" variant="secondary">Test your assistant</LinkButton></>}<Link href="/owner/knowledge/instructions" className="text-ink decoration-line-strong inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4">How your assistant helps</Link></div>
    <KnowledgeEditor readOnly={viewer} expiredIds={entries.filter(entry => entry.validUntil && entry.validUntil <= new Date()).map(entry => entry.id)} entries={entries.filter(entry => !entry.archived).map(toInput)} removedEntries={entries.filter(entry => entry.archived).map(toInput)} products={offers.map(({ row }) => ({ id: row.id, title: row.title }))} />
  </section>;
}
