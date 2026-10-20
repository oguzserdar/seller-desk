"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Textarea } from "@/components/arc/textarea/textarea";
import type { LearningWorkspaceItem } from "@/lib/learning-review";
import { LearningPreviewInput, type LearningPreviewView, type PreviewAnswer } from "@/lib/learning-preview";
import { previewReviewAction } from "./actions";

type Review = NonNullable<LearningWorkspaceItem["review"]>;
function Answer({ label, answer }: { label: string; answer: PreviewAnswer | null }) {
  return <div className="min-w-0"><h5 className="text-ink-2 text-[13px] font-semibold">{label}</h5>
    <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{answer?.text ?? "No completed answer saved."}</p>
    {answer ? <p className="text-ink-3 mt-3 text-[12px]">{(answer.latencyMs / 1000).toFixed(1)}s · Read shop facts</p> : null}
  </div>;
}
function Report({ report, revision, stale }: { report: LearningPreviewView; revision: number; stale: boolean }) {
  return <article className="border-line mt-5 border-t pt-5" aria-label="Saved answer comparison">
    <p className="text-ink-3 text-[12px]">{new Date(report.createdAt).toLocaleString()} · {report.state === "completed" ? "Both replies saved" : report.state === "running" ? "Comparison in progress" : "Comparison unfinished"}</p>
    <h4 className="mt-2 text-[17px] font-semibold">{report.question}</h4>
    {stale || report.reviewRevision !== revision ? <p className="text-attention mt-2 text-[13px]">An earlier saved version. This does not test your current draft.</p> : null}
    <div className="mt-4 grid gap-5 sm:grid-cols-2"><Answer label="Current knowledge" answer={report.current} /><Answer label="With your draft" answer={report.proposed} /></div>
    {report.failure ? <Alert className="mt-4" tone="warning" title={report.failure} /> : null}
    <details className="mt-4 text-[13px]"><summary className="text-ink-2 min-h-11 cursor-pointer py-3">Saved wording tested</summary><p className="whitespace-pre-wrap leading-relaxed">{report.draftBody}</p><p className="text-ink-3 mt-2 break-all">Model: {report.generator}</p></details>
  </article>;
}

/** A small private comparison beside the saved draft; successful generation never implies publication. */
export function PreviewFinding({ review, index, modelConnected, reports }: { review: Review; index: number; modelConnected: boolean; reports: LearningPreviewView[] }) {
  const id = useId(); const router = useRouter();
  const [question, setQuestion] = useState(""); const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<LearningPreviewView | null>(null);
  const request = useRef<LearningPreviewInput | null>(null);
  const action = useAction(previewReviewAction, {
    onSuccess: ({ data }) => { if (data) { setLatest(data); if (data.state !== "running") request.current = null; } router.refresh(); },
    onError: () => setError("The comparison could not be returned. Refresh saved results before trying again; any completed answer is kept."),
  });
  const finding = review.analysis.findings[index];
  const reusable = finding && ["reusable_fact", "product_rule", "temporary_information"].includes(finding.kind);
  const saved = review.editedDrafts.find(draft => draft.findingIndex === index);
  const published = review.publications.some(item => item.findingIndex === index);
  const canTry = reusable && saved && !review.stale && review.state === "draft" && !published;
  const savedReports = latest && !reports.some(report => report.id === latest.id) ? [latest, ...reports] : reports;
  if (!reusable && !savedReports.length) return null;
  return <details className="border-line mt-5 border-t pt-2">
    <summary className="text-brand min-h-11 cursor-pointer py-3 text-[14px] font-semibold">Try a customer question{savedReports.length ? ` · ${savedReports.length} saved` : ""}</summary>
    <p className="text-ink-2 mt-1 text-[14px] leading-relaxed">Compare two real AI replies before publishing. This checks knowledge only, not orders, payments or actions. Replies can vary; read both.</p>
    {canTry ? <form className="mt-4 space-y-3" onSubmit={event => {
      event.preventDefault(); setError(null);
      const next = { requestId: request.current?.requestId ?? crypto.randomUUID(), reviewId: review.id, expectedRevision: review.revision, findingIndex: index, question: question.trim() };
      if (request.current && (request.current.question !== next.question || request.current.expectedRevision !== next.expectedRevision)) next.requestId = crypto.randomUUID();
      const parsed = LearningPreviewInput.safeParse(next);
      if (!parsed.success) { setError("Enter a customer question between 5 and 1,000 characters."); return; }
      request.current = parsed.data; action.execute(parsed.data);
    }}>
      <Textarea label="Customer question" description="Uses your saved draft. Save any edits above first. Avoid private customer details." id={id} value={question} onChange={event => setQuestion(event.target.value)} rows={2} maxLength={1000} required disabled={action.isPending} />
      <p className="text-ink-3 text-[12px]">Uses your connected model for two answers and counts toward your shop’s AI usage.</p>
      <Button type="submit" variant="secondary" disabled={!modelConnected || action.isPending} loading={action.isPending}>Compare answers</Button>
      {!modelConnected ? <p className="text-ink-2 text-[13px]">Connect your assistant in setup to run a comparison.</p> : null}
    </form> : <p className="text-ink-2 mt-3 text-[14px]">{published ? "This fact is already published. Earlier comparisons are kept below." : "Save a complete draft in a current, open review to try it."}</p>}
    {error || action.result.serverError ? <Alert className="mt-3" tone="warning" title={action.result.serverError ?? error ?? ""} /> : null}
    <div aria-live="polite" aria-busy={action.isPending}>{savedReports.slice(0, 3).map(report => <Report key={report.id} report={report} revision={review.revision} stale={review.stale} />)}</div>
    {savedReports.length || error ? <Button variant="ghost" className="mt-3" disabled={action.isPending} onClick={() => router.refresh()}>Refresh saved results</Button> : null}
  </details>;
}
