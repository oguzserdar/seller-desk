"use client";

import { useId, useRef, useState } from "react";
import { ORDER_FOLLOWUP_LABEL, type OrderFollowupView } from "@/lib/order-followup";
import { Alert } from "@/components/arc/alert/alert";
import { Textarea } from "@/components/arc/textarea/textarea";
import { Button } from "@/components/arc/button/button";

/** Explicit human order-help action, never an assistant response. */
export type OrderHelpAction = { action: "help" | "reply"; message: string; expectedRevision: number } | { action: "confirm"; expectedRevision: number };

/** A conversation on the existing order, with durable sent messages and no inferred resolution. */
export function OrderHelp({ audience, view, onSend, onRefresh }: {
  audience: "buyer" | "owner";
  view: OrderFollowupView;
  onSend: (input: OrderHelpAction) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<{ message: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const buyer = audience === "buyer";
  const stale = draft !== null && draft.revision !== view.revision;
  const canWrite = buyer || view.state === "needs_help";
  const heading = buyer ? ORDER_FOLLOWUP_LABEL[view.state] : view.state === "needs_help" ? "Your customer needs help" : view.state === "awaiting_customer" ? "Waiting for your customer" : view.state === "confirmed" ? "Customer confirmed this problem is resolved" : "No customer problem reported";

  async function run(operation: () => Promise<void>, clearDraft: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await operation(); if (clearDraft) setDraft(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The message could not be confirmed. Your words are still here; try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section aria-labelledby={`${id}-heading`} className="border-line border-t pt-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={`${id}-heading`} className="text-[17px] font-semibold">{heading}</h2>
      {view.state !== "none" ? <Button variant="ghost" disabled={busy} onClick={() => void run(onRefresh, false)}>Check for replies</Button> : null}
    </div>
    {view.history.length > 0 ? <ol className="mt-3 flex flex-col gap-3" aria-label="Help with this order">
      {view.earlierMessages ? <li className="text-ink-3 text-[13px]">Showing the latest 20 messages.</li> : null}
      {view.history.map(item => <li key={item.revision} className="bg-sunken rounded-[10px] px-4 py-3">
        <p className="text-ink-3 text-[13px] font-semibold">{item.actor === "owner" ? buyer ? "The shop" : "You" : buyer ? "You" : "Customer"}</p>
        <p className="text-ink mt-1 whitespace-pre-wrap break-words text-[15px]">{item.state === "confirmed" ? "Confirmed this problem is resolved." : item.message}</p>
      </li>)}
    </ol> : <p className="text-ink-2 mt-2 text-[15px]">{buyer ? "Tell the shop what went wrong. Your purchase stays attached, so you do not need to explain it again." : "The customer can ask for help from their receipt."}</p>}
    {view.state === "needs_help" && buyer ? <p className="text-ink-2 mt-3 text-[14px]">Your message is saved for the shop. Return to this order to check for a reply.</p> : null}
    {view.state === "awaiting_customer" && !buyer ? <p className="text-ink-2 mt-3 text-[14px]">Your reply is saved on their receipt. The customer has not confirmed a resolution.</p> : null}
    {draft ? <form className="mt-4 flex flex-col gap-3" onSubmit={event => {
      event.preventDefault();
      if (stale || !canWrite || draft.message.trim().length < 3) return;
      void run(() => onSend({ action: buyer ? "help" : "reply", message: draft.message.trim(), expectedRevision: draft.revision }), true);
    }}>
      <Textarea label={buyer ? "What do you still need help with?" : "Your reply to the customer"} description="Unsent text is kept here until you leave this page." id={`${id}-message`} aria-describedby={`${id}-message-hint`} value={draft.message} minLength={3} maxLength={1000} rows={3} required disabled={busy} onChange={event => setDraft({ ...draft, message: event.target.value })} />
      {stale ? <Alert tone="warning" title="A newer message arrived.">Read it above before sending.
        {canWrite ? <Button variant="ghost" disabled={busy} onClick={() => setDraft({ ...draft, revision: view.revision })}>Reply to the latest message</Button> : <p>Your draft is still here to copy.</p>}
      </Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={stale || !canWrite || draft.message.trim().length < 3}>{buyer ? "Send to the shop" : "Send reply"}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
      </div>
    </form> : <div className="mt-3 flex flex-wrap gap-2">
      {canWrite ? <Button variant={buyer ? "secondary" : "primary"} disabled={busy} onClick={() => setDraft({ message: "", revision: view.revision })}>{buyer ? view.state === "none" ? "Ask for help" : "I still need help" : "Reply to customer"}</Button> : null}
      {buyer && (view.state === "needs_help" || view.state === "awaiting_customer") ? <Button variant="secondary" loading={busy} onClick={() => void run(() => onSend({ action: "confirm", expectedRevision: view.revision }), false)}>This problem is resolved</Button> : null}
    </div>}
    {buyer && view.state !== "none" ? <p className="text-ink-3 mt-2 text-[13px]">Confirming this problem does not change payment, delivery or your right to ask for help again.</p> : null}
    {error ? <div className="mt-3"><Alert tone="danger" title={error} /></div> : null}
  </section>;
}
