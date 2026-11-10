import type { Metadata } from "next";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { requireOwner } from "@/server/auth/owner";
import { getAssistantModel } from "@/server/ai/registry";
import { learningWorkspace } from "@/server/domain/learning-review";
import { listOwnerOffers } from "@/server/domain/offers";
import { listLearningPreviews } from "@/server/domain/learning-preview";
import { ReviewWorkspace } from "./review-workspace";

export const maxDuration = 120;

export const metadata: Metadata = { title: "Review seller answers" };

/** Authenticated review workspace; customer source material remains private to the owner. */
export default async function ReviewsPage() {
  const { owner } = await requireOwner(await headers());
  const [items, products, previews] = await Promise.all([learningWorkspace(owner), listOwnerOffers(owner), listLearningPreviews(owner)]);
  return <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
    <LinkButton href="/owner/knowledge" variant="ghost" className="-ml-4 mb-4"><ArrowLeft size={16} aria-hidden />Shop knowledge</LinkButton>
    <h1 className="page-title">Learn from your answers</h1>
    <p className="text-ink-2 mt-2 max-w-2xl text-[16px] leading-relaxed">You answered a customer. Review what could help the next one, and what should stay between you.</p>
    <ReviewWorkspace previews={previews} items={items} modelConnected={(await getAssistantModel()).ok} products={products.map(({ row }) => ({ id: row.id, title: row.title }))} />
  </section>;
}
