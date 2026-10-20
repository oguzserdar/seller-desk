"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatMoney, parsePriceInput } from "@/lib/money";
import { approveScopeAction, declineQuoteAction } from "../../actions";

/** Confirms or declines a service scope. Approval creates a new quote version the buyer must accept. */
export function ScopeReview({ quoteId, revision, defaultScope, currency, lines, pendingQuestion }: { quoteId: string; revision: number; defaultScope: string; currency: string; lines: { offerId: string; title: string; quantity: number; unitAmountMinor: number | null }[]; pendingQuestion?: { id: string; revision: number; question: string } }) {
  const router = useRouter();
  const [scope, setScope] = useState(defaultScope);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  // Keep the source question bound to the form the owner read, even on a refresh.
  const [questionToAnswer] = useState(pendingQuestion);
  const [answer, setAnswer] = useState("");
  const customLines = lines.filter((line) => line.unitAmountMinor === null);
  const parsedPrices = customLines.map((line) => ({ offerId: line.offerId, unitAmountMinor: parsePriceInput(prices[line.offerId] ?? "", currency) }));
  const validPrices = parsedPrices.every((price) => price.unitAmountMinor !== null && price.unitAmountMinor <= 10_000_000);
  const total = validPrices ? lines.reduce((sum, line) => sum + (line.unitAmountMinor ?? parsedPrices.find((price) => price.offerId === line.offerId)?.unitAmountMinor ?? 0) * line.quantity, 0) : null;
  const approve = useAction(approveScopeAction, {
    onSuccess: ({ data }) => {
      if (data) router.push(`/owner/quotes/${data.quoteId}`);
    },
  });
  const decline = useAction(declineQuoteAction, {
    onSuccess: () => {
      setMessage("Declined. The buyer sees your reason; nothing was charged.");
      router.refresh();
    },
  });
  const error = approve.result.serverError ?? decline.result.serverError ?? (approve.result.validationErrors ? "Check the scope and prices before sending." : null);
  return (
    <section className="surface mt-5 flex flex-col gap-4 p-5">
      <h2 className="text-[17px] font-semibold">Your review</h2>
      {customLines.map((line) => (
        <Input key={line.offerId} label={`${line.title}: price per item (${currency})`} description={`Quantity: ${line.quantity}. Include tax according to your shop terms.`} id={`price-${line.offerId}`} inputMode="decimal" placeholder="Enter your price" value={prices[line.offerId] ?? ""} onChange={(event) => setPrices((current) => ({ ...current, [line.offerId]: event.target.value }))} />
      ))}
      {customLines.length > 0 ? <p className="text-[15px] font-semibold" aria-live="polite">{total === null ? "Enter each price to see the total." : `Total for the buyer: ${formatMoney(total, currency)}`}</p> : null}
      <Textarea label="Confirmed scope" description="Exactly what the price covers. The buyer sees this before paying. Do not promise a time here." id="scope" rows={4} value={scope} onChange={(e) => setScope(e.target.value)} maxLength={1000} />
      {questionToAnswer ? <section className="flex flex-col gap-3 border-t border-line pt-4" aria-label="Customer question with this quote">
        <h3 className="text-[15px] font-semibold">They also asked</h3>
        <p className="text-[14px] leading-relaxed text-ink-2">{questionToAnswer.question}</p>
        <Textarea label="Your answer (optional)" description="Send your answer with this quote. Leave it blank to keep the question open. Payment does not book a time." id="quote-answer" rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={1000} />
      </section> : null}
      <Button
        className="self-start"
        disabled={scope.trim().length < 3 || !validPrices || (total !== null && total > 100_000_000) || decline.isPending}
        loading={approve.isPending}
        onClick={() => {
          if (!validPrices) return;
          approve.execute({ quoteId, expectedRevision: revision, approvedScope: scope, prices: parsedPrices.map((price) => ({ offerId: price.offerId, unitAmountMinor: price.unitAmountMinor! })), ...(questionToAnswer && answer.trim() ? { answer: { questionId: questionToAnswer.id, expectedRevision: questionToAnswer.revision, answer: answer.trim() } } : {}) });
        }}
      >
        {questionToAnswer && answer.trim() ? "Send quote and answer" : "Send quote to buyer"}
      </Button>
      <hr className="border-line" />
      <Textarea label="Or decline, with a reason the buyer sees" id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      <Button
        variant="danger"
        className="self-start"
        disabled={reason.trim().length < 3 || approve.isPending}
        loading={decline.isPending}
        onClick={() => {
          if (window.confirm("Decline this quote? The buyer cannot pay for it after this.")) decline.execute({ quoteId, expectedRevision: revision, reason });
        }}
      >
        Decline quote
      </Button>
      {error ? <Alert tone="danger" title={error} /> : null}
      {message ? <Alert tone="success" title={message} /> : null}
    </section>
  );
}
