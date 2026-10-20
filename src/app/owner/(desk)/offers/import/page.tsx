import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getAssistantModel } from "@/server/ai/registry";
import { requireOwner } from "@/server/auth/owner";
import { AiDraftForm } from "./ai-draft-form";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Add offers" };

/** Offers AI drafting and reviewed catalog-file import to the signed-in owner. */
export default async function ImportPage() {
  const { seller } = await requireOwner(await headers());
  return (
    <section className="w-full max-w-3xl px-4 pt-8 pb-16 sm:px-8">
      <Link href="/owner/offers" className="text-ink-2 hover:text-ink text-[15px] font-medium">
        Offers
      </Link>
      <h1 className="page-title mt-2">Add your offers</h1>
      <p className="text-ink-2 mt-2 text-[17px]">Every offer starts as an unpublished draft. You check it, finish it and publish it.</p>
      <AiDraftForm modelReady={(await getAssistantModel()).ok} currency={seller.currency} />
      <section aria-labelledby="list-heading" className="border-line mt-12 border-t pt-8">
        <h2 id="list-heading" className="text-[22px] font-semibold tracking-[-0.015em]">
          Bring your existing catalog
        </h2>
        <p className="text-ink-2 mt-1 text-[16px]">Upload a small catalog export or paste spreadsheet rows. Review the prices and stock before adding drafts. This file import does not use AI.</p>
        <ImportForm />
      </section>
    </section>
  );
}
