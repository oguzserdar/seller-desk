import type { SimulationSideResult, SimulationView } from "@/lib/simulation";
import { Alert } from "@/components/arc/alert/alert";
import { Accordion } from "@/components/arc/accordion/accordion";
import { formatMoney } from "@/lib/money";
import { PERSONAS } from "@/lib/simulation-personas";

const timestamp = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";

/** Shows recorded model output and independently read commerce results; an ended run is not labeled a pass. */
export function SimulationReport({ report }: { report: SimulationView }) {
  return <article className="border-line mt-6 border-t pt-6" aria-label="Saved assistant test">
    <p className="text-ink-3 text-[12px]">{timestamp(report.createdAt)} · {report.state === "completed" ? "Run finished · review the results" : report.state === "running" ? "Run in progress" : "Run unfinished"}</p>
    <h3 className="mt-2 text-[18px] font-semibold [overflow-wrap:anywhere]">{report.scenario}</h3>
    <p className="text-ink-2 mt-2 text-[14px]">Your expectation: {report.expectedOutcome}</p>
    <div className={`mt-5 grid gap-6 ${report.change ? "lg:grid-cols-2" : ""}`}>
      <Side label="Published shop" result={report.current} />
      {report.change ? <Side label={`With ${report.change.content.title} · saved version ${report.change.revision}`} result={report.proposed} /> : null}
    </div>
    {report.failure ? <Alert tone="warning" className="mt-4" title={report.failure} /> : null}
    <div className="mt-4"><Accordion defaultOpen={-1} items={[{ title: "Test conditions and authorized actions", content: <>
      <p className="break-all">Model: {report.generator}</p><p className="mt-2">Published facts captured {timestamp(report.capturedAt)}. Shop facts may since have changed.</p>
      {report.steps.length ? <ol className="mt-3 list-inside list-decimal space-y-2">{report.steps.map((step, i) => <li key={i}>{step.kind === "customer" ? `Customer: ${step.text}` : step.kind === "seller_reply" ? `Seller: ${step.text}` : step.kind === "simulated_customer" ? `Simulated customer · ${PERSONAS[step.persona].label}, ${step.turns} ${step.turns === 1 ? "turn" : "turns"}` : <>{step.expected.lines.map(line => `${line.quantity} × ${report.products.find(product => product.id === line.sourceOfferId)?.title ?? "Captured offer"}`).join(", ")} · {formatMoney(step.expected.totalMinor, step.expected.currency)}. {step.kind === "approve_scope" ? `Seller approves: ${step.scope}` : `Fictional payer approves this exact purchase. ${step.fault === "none" ? "Ordinary payment." : "Lost capture and delivery retry."}`}</>}</li>)}</ol> : <p className="mt-2">No seller approval or fictional payment was authorized.</p>}
      {report.change ? <div className="mt-3"><p className="font-semibold">Saved wording tested</p><p>{report.change.content.whenToUse}</p><p className="mt-2 whitespace-pre-wrap">{report.change.content.steps}</p></div> : null}
      <ul className="mt-3 list-inside list-disc space-y-1">{report.limitations.map(item => <li key={item}>{item}</li>)}<li>Commerce is fictional; this does not verify PayPal sandbox or live payments.</li><li>Each test runs in a separate practice copy of your shop. Your real orders and stock do not change.</li></ul>
    </> }]} /></div>
  </article>;
}

function Side({ label, result }: { label: string; result: SimulationSideResult | null }) {
  return <section className="min-w-0"><h4 className="text-[14px] font-semibold">{label}</h4>
    {!result ? <p className="text-ink-3 mt-3 text-[14px]">No result saved for this side.</p> : <>
      <ol className="mt-4 space-y-4">{result.transcript.map((message, i) => <li key={i}><p className="text-ink-3 text-[12px] font-semibold">{message.role === "user" ? "Customer" : message.role === "seller" ? "Seller" : "Assistant"}</p><p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{message.text}</p></li>)}</ol>
      <dl className="border-line mt-5 grid grid-cols-2 gap-3 border-y py-4 text-[13px]">
        {[["Quotes", result.records.quotes], ["Paid orders", result.records.paidOrders], ["Payments", result.records.captures], ["Waiting for seller", result.records.openSellerQuestions], ["Tasks pending", result.records.pendingTasks], ["Tasks finished", result.records.completedTasks]].map(([key, value]) => <div key={key}><dt className="text-ink-3">{key}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
      </dl>
      <ul className="mt-4 space-y-2 text-[13px]">{result.checks.map((check, i) => <li key={i}><p className="font-semibold">{check.passed ? "✓" : "!"} {check.label}</p><p className="text-ink-2 mt-1">{check.detail}</p></li>)}</ul>
      <p className="text-ink-3 mt-4 text-[12px]">{(result.latencyMs / 1000).toFixed(1)}s recorded model time · {result.approvals.length} explicit approvals</p>
      <Accordion defaultOpen={-1} items={[{ title: "Actions observed", content: <ul className="space-y-2">{result.tools.map((tool, i) => <li key={i}>{tool.name} · {tool.state === "output-error" ? "reported an error" : "returned a result"}</li>)}</ul> }]} />
    </>}
  </section>;
}
