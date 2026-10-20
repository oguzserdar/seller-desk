"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Plus } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { PROCEDURE_LIMIT, type ProcedureEditorValue } from "@/lib/assistant-procedure";
import { restoreInstructionAction } from "./actions";
import { InstructionEditor } from "./instruction-editor";
import type { ProcedurePreviewView } from "@/lib/procedure-preview";

/** Existing Knowledge styling with one editor at a time and no workflow-builder canvas. */
export function InstructionWorkspace({ entries, previews, modelConnected }: { entries: ProcedureEditorValue[]; previews: ProcedurePreviewView[]; modelConnected: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProcedureEditorValue | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = entries.filter(row => !row.archived), archived = entries.filter(row => row.archived);
  const restore = useAction(restoreInstructionAction, { onSuccess: ({ data }) => {
    if (data) { setEditing(data); setNotice("Restored as a private draft. Review it before publishing."); router.refresh(); }
  } });
  if (editing) return <InstructionEditor key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} previews={previews} modelConnected={modelConnected} onClose={() => { setEditing(null); router.refresh(); }} />;
  return <div className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-ink-2 text-[14px]">{active.filter(row => row.publishedRevision !== null).length} in use · {active.length} of {PROCEDURE_LIMIT} instructions</p>
      <Button variant="secondary" disabled={active.length >= PROCEDURE_LIMIT || restore.isPending} onClick={() => { setNotice(null); setEditing("new"); }}><Plus size={17} aria-hidden />Add instruction</Button>
    </div>
    {notice ? <Alert className="mt-4" title={notice} /> : null}
    {restore.result.serverError ? <Alert tone="danger" className="mt-4" title={restore.result.serverError} /> : null}
    {active.length ? <ul className="divide-line border-line mt-5 divide-y border-y">{active.map(row => <li key={row.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><Badge tone={row.publishedRevision === null ? "neutral" : "info"}>{row.publishedRevision === null ? "Not in use" : row.publishedRevision === row.revision ? "In use" : "In use · newer draft"}</Badge><h2 className="mt-2 text-[19px] font-semibold [overflow-wrap:anywhere]">{row.content.title}</h2><p className="text-ink-2 mt-1 text-[14px] [overflow-wrap:anywhere]">{row.content.whenToUse}</p></div>
      <Button variant="ghost" aria-label={`Edit ${row.content.title}`} disabled={restore.isPending} onClick={() => { setNotice(null); setEditing(row); }}>Edit</Button>
    </li>)}</ul> : <section className="border-line mt-5 border-y py-9"><h2 className="text-[21px] font-semibold">Start with a job you often explain.</h2><p className="text-ink-2 mt-3 max-w-xl text-[15px] leading-relaxed">For urgent repairs, ask what is wrong and when the customer needs it. Bring the deadline to you before promising a time.</p><p className="text-ink-3 mt-2 text-[13px]">This is an example. Nothing is added or published automatically.</p></section>}
    {archived.length ? <details className="border-line mt-6 border-t"><summary className="text-ink-2 min-h-11 cursor-pointer py-3 text-[14px] font-semibold">Archived instructions ({archived.length})</summary><ul>{archived.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="min-w-0 text-[15px] [overflow-wrap:anywhere]">{row.content.title}</span><Button variant="ghost" disabled={restore.isPending || active.length >= PROCEDURE_LIMIT} onClick={() => restore.execute({ id: row.id, expectedRevision: row.revision, restoreRevision: row.revision })}>Restore as draft</Button></li>)}</ul></details> : null}
    <p className="text-ink-3 mt-6 text-[13px] leading-relaxed">Instructions guide the conversation. Your catalog sets prices, you review seller decisions, and the customer approves payment in PayPal.</p>
  </div>;
}
