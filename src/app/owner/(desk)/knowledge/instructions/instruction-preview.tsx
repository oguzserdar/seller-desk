"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Textarea } from "@/components/arc/textarea/textarea";
import type { ProcedureEditorValue } from "@/lib/assistant-procedure";
import { ProcedurePreviewInput, type ProcedurePreviewView } from "@/lib/procedure-preview";
import { previewInstructionAction } from "./actions";

/** A collapsed real-reply comparison; saving, testing and publishing remain separate choices. */
export function InstructionPreview({ saved, dirty, busy, modelConnected, reports }: {
  saved: ProcedureEditorValue; dirty: boolean; busy: boolean; modelConnected: boolean; reports: ProcedurePreviewView[];
}) {
  const field = useId(), router = useRouter();
  const [question, setQuestion] = useState("");
  const [latest, setLatest] = useState<ProcedurePreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<ProcedurePreviewInput | null>(null);
  const action = useAction(previewInstructionAction, {
    onSuccess: ({ data }) => { if (data) { setLatest(data); if (data.state !== "running") request.current = null; } router.refresh(); },
    onError: () => setError("The result could not be returned. Refresh saved replies before trying again; completed replies are kept."),
  });
  const savedReports = latest && !reports.some(report => report.id === latest.id) ? [latest, ...reports] : reports;
  return <details className="border-line mt-7 border-t pt-2">
    <summary className="text-brand min-h-11 cursor-pointer py-3 text-[14px] font-semibold">Try a customer question{savedReports.length ? ` · ${savedReports.length} saved` : ""}</summary>
    <p className="text-ink-2 text-[14px] leading-relaxed">Compare a reply using your published instructions with one using this saved version. This checks the answer only. It cannot contact customers, ask you a real question, create a quote or take payment.</p>
    <form className="mt-4 space-y-3" onSubmit={event => {
      event.preventDefault(); if (dirty || busy || action.isPending || !modelConnected) return;
      setError(null);
      const previous = request.current;
      const input = { requestId: previous && previous.expectedRevision === saved.revision && previous.question === question.trim() ? previous.requestId : crypto.randomUUID(), procedureId: saved.id, expectedRevision: saved.revision, question: question.trim() };
      const parsed = ProcedurePreviewInput.safeParse(input);
      if (!parsed.success) { setError("Write a customer question between 5 and 1,000 characters."); return; }
      request.current = parsed.data; action.execute(parsed.data);
    }}>
      <Textarea label="Customer question to try" description="Use a fictional request and avoid private customer details." id={field} value={question} rows={3} maxLength={1000} required disabled={action.isPending || busy} onChange={event => setQuestion(event.target.value)} />
      <p className="text-ink-3 text-[12px]">Two real replies from your connected model, counted toward your shop’s AI usage. Nothing is published.</p>
      <Button type="submit" variant="secondary" disabled={dirty || busy || action.isPending || !modelConnected} loading={action.isPending}>Compare replies</Button>
      {dirty ? <p className="text-ink-2 text-[13px]">Save your edits first so the comparison tests the exact wording.</p> : null}
      {!modelConnected ? <p className="text-ink-2 text-[13px]">Connect your assistant in setup before comparing replies.</p> : null}
    </form>
    {error || action.result.serverError ? <Alert tone="warning" className="mt-4" title={action.result.serverError ?? error ?? ""} /> : null}
    <div aria-live="polite" aria-busy={action.isPending}>{savedReports.slice(0, 3).map(report => <article key={report.id} className="border-line mt-5 border-t pt-5" aria-label="Saved instruction comparison">
      <p className="text-ink-3 text-[12px]">{new Date(report.createdAt).toLocaleString()} · {report.state === "completed" ? "Both replies saved" : report.state === "running" ? "Comparison in progress" : "Comparison unfinished"}</p>
      <h3 className="mt-2 text-[17px] font-semibold [overflow-wrap:anywhere]">{report.question}</h3>
      {dirty || report.revision !== saved.revision || report.publishedRevision !== saved.publishedRevision ? <p className="text-attention mt-2 text-[13px]">Earlier wording. This does not test your current draft and published settings.</p> : null}
      <div className="mt-4 grid gap-5 sm:grid-cols-2">{([['Published instructions', report.current], ['With this saved version', report.proposed]] as const).map(([label, answer]) => <div key={label} className="min-w-0"><h4 className="text-ink-2 text-[13px] font-semibold">{label}</h4><p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{answer?.text ?? "No completed reply saved."}</p>{answer ? <p className="text-ink-3 mt-3 text-[12px]">{(answer.latencyMs / 1000).toFixed(1)}s · Read shop facts</p> : null}</div>)}</div>
      {report.failure ? <Alert tone="warning" className="mt-4" title={report.failure} /> : null}
      <details className="mt-3 text-[13px]"><summary className="text-ink-2 min-h-11 cursor-pointer py-3">Wording tested</summary><p className="font-semibold">{report.wording.title}</p><p className="mt-1">{report.wording.whenToUse}</p><p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{report.wording.steps}</p><p className="text-ink-3 mt-3 break-all">Model: {report.generator}</p></details>
      <p className="text-ink-3 mt-2 text-[12px]">Uses the shop facts saved at the time above. Facts and other instructions may have changed. Read both replies; this is not a checkout or handoff test.</p>
    </article>)}</div>
    {savedReports.length || error ? <Button variant="ghost" className="mt-3" disabled={action.isPending || busy} onClick={() => router.refresh()}>Refresh saved replies</Button> : null}
  </details>;
}
