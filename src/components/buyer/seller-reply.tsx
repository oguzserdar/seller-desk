"use client";

import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";

/** Buyer-visible seller handoff without internal model errors or runner details. */
export type SellerHandoff = {
  question: string;
  answer: string | null;
  state: "open" | "answered" | "resumed" | "closed";
  retrying: boolean;
  deliveredBySeller?: boolean;
};

/** Shows the seller's own words even when the AI continuation has failed. */
export function SellerReply({ handoff, shopName, canContinue, onContinue }: {
  handoff: SellerHandoff;
  shopName: string;
  canContinue: boolean;
  onContinue: () => void;
}) {
  if (handoff.deliveredBySeller) return null;
  // The question card in the conversation carries the wait; saying it here too repeated it.
  if (handoff.state === "open") return null;
  if (!handoff.answer) return null;
  return (
    <Alert tone={handoff.state === "closed" ? "warning" : "info"} title={`Answer from ${shopName}`}>
      <p className="text-ink-2 text-[14px]">{handoff.question}</p>
      <blockquote className="mt-2 whitespace-pre-wrap text-[16px]">{handoff.answer}</blockquote>
      {handoff.state === "answered" ? <p role="status" className="mt-2 text-[14px]">{handoff.retrying ? "The assistant could not continue yet. It will retry; the seller's answer is saved here." : "The assistant will continue from this answer."}</p> : null}
      {handoff.state === "closed" ? (
        <div className="mt-3">
          <p className="text-[14px]">The automatic reply failed. You can still use the seller's answer and browse the shop.</p>
          {canContinue ? <Button className="mt-3" onClick={onContinue}>Continue with this answer</Button> : null}
        </div>
      ) : null}
    </Alert>
  );
}
