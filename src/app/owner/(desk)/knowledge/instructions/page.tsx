import type { Metadata } from "next";
import { headers } from "next/headers";
import { LinkButton } from "@/components/link-button";
import { procedureEditorValue } from "@/lib/assistant-procedure";
import { requireOwner } from "@/server/auth/owner";
import { listProcedures } from "@/server/domain/assistant-procedures";
import { InstructionWorkspace } from "./instruction-workspace";
import { listProcedurePreviews } from "@/server/domain/procedure-preview";
import { getAssistantModel } from "@/server/ai/registry";

export const maxDuration = 120;

export const metadata: Metadata = { title: "Assistant instructions" };

/** A small owner workspace for approved handling instructions, separate from public shop facts. */
export default async function InstructionsPage() {
  const { owner } = await requireOwner(await headers());
  const entries = await listProcedures(owner, true);
  const previews = await listProcedurePreviews(owner);
  return <section className="w-full max-w-3xl px-4 py-8 sm:px-8">
    <LinkButton href="/owner/knowledge" variant="ghost" className="mb-4 -ml-4">Back to shop knowledge</LinkButton>
    <h1 className="page-title">How your assistant helps</h1>
    <p className="text-ink-2 mt-3 max-w-2xl text-[16px] leading-relaxed">Tell it what to ask, what to check and when to bring a decision to you. Save your wording privately, then publish it when ready.</p>
    <InstructionWorkspace entries={entries.map(procedureEditorValue)} previews={previews} modelConnected={getAssistantModel().ok} />
  </section>;
}
