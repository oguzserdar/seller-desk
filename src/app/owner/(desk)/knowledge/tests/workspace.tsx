"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { Select } from "@/components/arc/select/select";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Accordion } from "@/components/arc/accordion/accordion";
import { LinkButton } from "@/components/link-button";
import { SimulationInput, customerTurns, type SimulationStep, type SimulationView } from "@/lib/simulation";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/simulation-personas";
import { formatMoney, parsePriceInput } from "@/lib/money";
import { SimulationReport } from "./report";
import { runSimulationAction } from "./actions";

/** Only published product facts needed to author fictional purchases; no customer or credential data. */
export type TrialOffer = { id: string; title: string; kind: string; unitAmountMinor: number | null; currency: string };
const ACTORS = [
  { value: "customer", label: "Customer follows up" },
  { value: "simulated_customer", label: "Simulated customer plays a part" },
  { value: "seller_reply", label: "You answer a question" },
  { value: "approve_scope", label: "You approve the service scope" },
  { value: "pay_quote", label: "Customer pays the exact quote (fictional)" },
];

/** Arc controls author bounded actor plans. No field can supply an assistant response. */
export function SimulationWorkspace({ connected, reports, offers, instructions }: {
  connected: boolean; reports: SimulationView[]; offers: TrialOffer[];
  instructions: { id: string; title: string; revision: number }[];
}) {
  const router = useRouter();
  const [scenario, setScenario] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [instruction, setInstruction] = useState("none");
  const [plan, setPlan] = useState<{ id: string; step: SimulationStep }[]>([]);
  const steps = plan.map(item => item.step);
  const [actor, setActor] = useState("customer");
  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<SimulationView | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const action = useAction(runSimulationAction, {
    onSuccess: ({ data }) => { if (data) { setLatest(data); if (data.state !== "running") request.current = null; } router.refresh(); },
    onError: () => setError("The connection stopped. Refresh saved tests before starting another; any saved result is kept."),
  });
  const busy = action.isPending;
  const signature = JSON.stringify({ scenario, expectedOutcome, instruction, steps });
  const hasApproval = steps.some(step => step.kind === "approve_scope" || step.kind === "pay_quote");
  const shown = latest ? [latest, ...reports.filter(report => report.id !== latest.id)] : reports;
  const update = (index: number, step: SimulationStep) => setPlan(old => old.map((item, i) => i === index ? { ...item, step } : item));
  return <>
    {!connected ? <Alert tone="warning" className="mt-6" title="Connect your assistant before running a test."><LinkButton href="/owner/setup#assistant" variant="ghost">Assistant setup</LinkButton></Alert> : null}
    <form method="post" className="mt-7 max-w-3xl space-y-5" onSubmit={event => {
      event.preventDefault(); if (busy || !connected || (hasApproval && confirmedPlan !== signature)) return;
      setError(null);
      const change = instructions.find(item => item.id === instruction);
      const id = request.current?.signature === signature ? request.current.id : crypto.randomUUID();
      const parsed = SimulationInput.safeParse({ requestId: id, scenario, expectedOutcome, steps,
        change: change ? { kind: "instruction", id: change.id, revision: change.revision } : { kind: "none" } });
      if (!parsed.success) { setError("Check your request, expected result and each step. Purchases need a published offer, quantity and exact positive total. Use at most three customer follow-ups."); return; }
      request.current = { signature, id }; action.execute(parsed.data);
    }}>
      <Textarea label="What does the customer say?" description="Use a fictional request. For example: ‘I need a repair by Friday. Can you guarantee it?’" value={scenario} onChange={e => setScenario(e.target.value)} minLength={5} maxLength={2000} required rows={3} disabled={busy} />
      <Textarea label="What should happen?" description="Your checklist for reading the result. The assistant does not see it." value={expectedOutcome} onChange={e => setExpectedOutcome(e.target.value)} minLength={5} maxLength={1000} required rows={2} disabled={busy} />
      <Select label="Shop version" value={instruction} onValueChange={setInstruction} disabled={busy} options={[
        { value: "none", label: "Published shop only" },
        ...instructions.map(item => ({ value: item.id, label: `Compare with ${item.title} · saved version ${item.revision}` })),
      ]} description="Runs the same plan on your published shop and the selected saved wording. Publishing stays separate." />
      <Accordion defaultOpen={-1} items={[{ title: `Follow-ups, seller approval or a fictional payment${steps.length ? ` · ${steps.length} ${steps.length === 1 ? "step" : "steps"}` : ""}`, content: <>
        <p className="text-ink-2 mb-4 text-[14px] leading-relaxed">These steps act as fictional customers and sellers. Review each purchase below before running it.</p>
        <div className="space-y-5">{steps.map((step, index) => <fieldset key={plan[index]!.id} disabled={busy} className="border-line border-t pt-5">
          <legend className="pt-3 text-[14px] font-semibold">{index + 2}. {ACTORS.find(item => item.value === step.kind)?.label}</legend>
          {step.kind === "customer" || step.kind === "seller_reply"
            ? <Textarea label={step.kind === "customer" ? "Customer message" : "Seller reply"} value={step.text} onChange={e => update(index, { ...step, text: e.target.value })} rows={2} maxLength={step.kind === "customer" ? 2000 : 1000} />
            : step.kind === "simulated_customer"
              ? <div className="mt-3 space-y-4">
                  <Select label="Who the customer is" value={step.persona} onValueChange={persona => update(index, { ...step, persona: persona as PersonaId })} options={PERSONA_IDS.map(id => ({ value: id, label: PERSONAS[id].label }))} description={`${PERSONAS[step.persona].description} The AI writes their messages from your published offers.`} />
                  <Select label="Messages they send" value={String(step.turns)} onValueChange={turns => update(index, { ...step, turns: Number(turns) })} options={[1, 2, 3].map(n => ({ value: String(n), label: String(n), disabled: customerTurns(steps) - step.turns + n > 3 }))} />
                </div>
              : <PurchaseStep step={step} offers={offers} onChange={next => update(index, next)} />}
          <Button type="button" variant="ghost" className="mt-2" onClick={() => setPlan(old => old.filter((_, i) => i !== index))}>Remove step</Button>
        </fieldset>)}</div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Select label="Next step" value={actor} onValueChange={setActor} disabled={busy || steps.length >= 6} options={ACTORS.map(item => ({ ...item, disabled: ((item.value === "customer" || item.value === "simulated_customer") && customerTurns(steps) >= 3) || (item.value === "pay_quote" && !offers.length) || (item.value === "approve_scope" && !offers.some(offer => offer.kind === "service")) }))} />
          <Button type="button" variant="secondary" disabled={busy || steps.length >= 6} onClick={() => {
            if (actor === "customer" || actor === "seller_reply") { if (actor === "customer" && customerTurns(steps) >= 3) return; setPlan(old => [...old, { id: crypto.randomUUID(), step: { kind: actor, text: "" } }]); return; }
            if (actor === "simulated_customer") { const left = 3 - customerTurns(steps); if (left < 1) return; setPlan(old => [...old, { id: crypto.randomUUID(), step: { kind: "simulated_customer", persona: "haggler", turns: Math.min(2, left) } }]); return; }
            const offer = actor === "approve_scope" ? offers.find(offer => offer.kind === "service") : offers[0]; if (!offer) return;
            const expected = { lines: [{ sourceOfferId: offer.id, quantity: 1 }], totalMinor: offer.unitAmountMinor ?? 0, currency: offer.currency };
            setPlan(old => [...old, { id: crypto.randomUUID(), step: actor === "approve_scope" ? { kind: "approve_scope", expected, scope: "", prices: [] } : { kind: "pay_quote", expected, fault: "none" } }]);
          }}>Add step</Button>
        </div>
      </> }]} />
      {hasApproval ? <Checkbox checked={confirmedPlan === signature} onCheckedChange={checked => setConfirmedPlan(checked === true ? signature : null)} disabled={busy} label="Run the seller approvals and fictional purchases shown above." description="Approves only the products, quantity, scope and total shown. Editing the plan clears your approval." /> : null}
      <p className="text-ink-3 text-[13px] leading-relaxed">Uses your connected AI and counts toward your daily limit. Quotes and purchases run in a separate fictional shop. Your customers, stock and orders stay unchanged. Results are saved here.</p>
      <Button type="submit" loading={busy} disabled={busy || !connected || (hasApproval && confirmedPlan !== signature)}>{instruction === "none" ? "Run test" : "Run comparison"}</Button>
      {busy ? <p role="status" className="text-ink-2 text-[14px]">Running the plan in order. Longer conversations can take several minutes. Keep this page open.</p> : null}
      {error || action.result.serverError ? <Alert tone="warning" title={action.result.serverError ?? error ?? ""} /> : null}
    </form>
    <div className="border-line mt-10 border-t pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[20px] font-semibold">Saved tests</h2><Button variant="ghost" disabled={busy} onClick={() => router.refresh()}>Refresh saved tests</Button></div>
      {!shown.length ? <p className="text-ink-2 mt-3 text-[15px]">Run your first test to see its conversation, actions and order records here.</p> : shown.map(report => <SimulationReport key={report.id} report={report} />)}
    </div>
  </>;
}

function PurchaseStep({ step, offers, onChange }: { step: Extract<SimulationStep, { kind: "approve_scope" | "pay_quote" }>; offers: TrialOffer[]; onChange: (step: SimulationStep) => void }) {
  const amounts = step.expected.lines.map(line => {
    const offer = offers.find(offer => offer.id === line.sourceOfferId);
    const price = offer?.unitAmountMinor ?? (step.kind === "approve_scope" ? step.prices.find(price => price.sourceOfferId === line.sourceOfferId)?.unitAmountMinor : null);
    return price ? price * line.quantity : null;
  });
  const totalHint = amounts.every(amount => amount !== null)
    ? `Listed total for these quantities: ${formatMoney(amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0), step.expected.currency)}. Confirm the exact amount below.`
    : "Confirm the exact total after the seller supplies a custom price.";
  const changeLines = (lines: typeof step.expected.lines) => onChange({ ...step, expected: { ...step.expected, lines }, ...(step.kind === "approve_scope" ? { prices: step.prices.filter(price => lines.some(line => line.sourceOfferId === price.sourceOfferId)) } : {}) });
  return <div className="mt-3 space-y-4">
    {step.expected.lines.map((line, index) => {
      const selected = offers.find(offer => offer.id === line.sourceOfferId);
      return <div key={index} className="border-line space-y-3 border-b pb-4">
        <Select label={`Offer ${index + 1}`} value={line.sourceOfferId} options={offers.map(offer => ({ value: offer.id, label: offer.title, disabled: step.expected.lines.some((other, i) => i !== index && other.sourceOfferId === offer.id) || offer.currency !== step.expected.currency }))} onValueChange={id => changeLines(step.expected.lines.map((item, i) => i === index ? { ...item, sourceOfferId: id } : item))} />
        <Input label={`Quantity for offer ${index + 1}`} type="number" min={1} max={99} value={line.quantity} onChange={e => changeLines(step.expected.lines.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) } : item))} description={selected?.unitAmountMinor ? `Listed unit price: ${formatMoney(selected.unitAmountMinor, selected.currency)}.` : "The seller must supply a price before payment."} />
        {step.kind === "approve_scope" && selected?.unitAmountMinor === null ? <Input key={selected.id} label={`Service unit price for offer ${index + 1} (${step.expected.currency})`} inputMode="decimal" defaultValue={step.prices.find(price => price.sourceOfferId === selected.id)?.unitAmountMinor ? (step.prices.find(price => price.sourceOfferId === selected.id)!.unitAmountMinor / 100).toFixed(2) : ""} onChange={e => onChange({ ...step, prices: [...step.prices.filter(price => price.sourceOfferId !== selected.id), { sourceOfferId: selected.id, unitAmountMinor: parsePriceInput(e.target.value, step.expected.currency) ?? 0 }] })} /> : null}
        {step.expected.lines.length > 1 ? <Button type="button" variant="ghost" onClick={() => changeLines(step.expected.lines.filter((_, i) => i !== index))}>Remove offer {index + 1}</Button> : null}
      </div>;
    })}
    <Button type="button" variant="ghost" disabled={step.expected.lines.length >= 10 || !offers.some(offer => offer.currency === step.expected.currency && !step.expected.lines.some(line => line.sourceOfferId === offer.id))} onClick={() => {
      const next = offers.find(offer => offer.currency === step.expected.currency && !step.expected.lines.some(line => line.sourceOfferId === offer.id));
      if (next) changeLines([...step.expected.lines, { sourceOfferId: next.id, quantity: 1 }]);
    }}>Add another offer</Button>
    <Input label={`Exact full total (${step.expected.currency})`} inputMode="decimal" defaultValue={(step.expected.totalMinor / 100).toFixed(2)} description={totalHint} onChange={e => onChange({ ...step, expected: { ...step.expected, totalMinor: parsePriceInput(e.target.value, step.expected.currency) ?? 0 } })} />
    {step.kind === "approve_scope" ? <Textarea label="Scope the seller approves" value={step.scope} onChange={e => onChange({ ...step, scope: e.target.value })} minLength={3} maxLength={1000} rows={2} /> : <Select label="Payment condition" value={step.fault} onValueChange={fault => onChange({ ...step, fault: fault as "none" | "lost_capture_and_download" })} options={[{ value: "none", label: "Ordinary fictional checkout" }, { value: "lost_capture_and_download", label: "PayPal reply lost, download sent again" }]} />}
  </div>;
}
