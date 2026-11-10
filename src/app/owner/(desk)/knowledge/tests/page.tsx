import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireOwner } from "@/server/auth/owner";
import { getAssistantModel } from "@/server/ai/registry";
import { listOwnerOffers } from "@/server/domain/offers";
import { listProcedures } from "@/server/domain/assistant-procedures";
import { listSimulations } from "@/server/simulation/runs";
import { LinkButton } from "@/components/link-button";
import { SimulationWorkspace } from "./workspace";

export const maxDuration = 300;
export const metadata: Metadata = { title: "Test your assistant" };

/** Private trials use the real chat and commerce handlers in fresh fictional shops. */
export default async function SimulationPage() {
  const { owner } = await requireOwner(await headers());
  const reports = await listSimulations(owner);
  const offers = await listOwnerOffers(owner);
  const instructions = await listProcedures(owner);
  return <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
    <LinkButton href="/owner/knowledge" variant="ghost" className="mb-4 -ml-4">Back to shop knowledge</LinkButton>
    <h1 className="page-title">Test your assistant</h1>
    <p className="text-ink-2 mt-3 max-w-2xl text-[16px] leading-relaxed">Try a customer request before it happens. Read what your assistant says, which actions it takes and where it asks for help.</p>
    <SimulationWorkspace connected={(await getAssistantModel()).ok} reports={reports}
      offers={offers.filter(({ row }) => row.published).map(({ row }) => ({ id: row.id, title: row.title, kind: row.kind, unitAmountMinor: row.unitAmountMinor, currency: row.currency }))}
      instructions={instructions.filter(row => !row.archived).map(row => ({ id: row.id, title: row.content.title, revision: row.revision }))} />
  </section>;
}
