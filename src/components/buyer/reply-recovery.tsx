"use client";

import { Button } from "@/components/arc/button/button";
import type { BuyerReplyState } from "@/lib/conversation-messages";

/** Offers an explicit retry for saved unanswered input; never fabricates a recovered AI reply. */
export function ReplyRecovery({ state, onContinue }: { state: BuyerReplyState; onContinue: () => void }) {
  if (state === "idle") return null;
  return (
    <div className="border-line border-t pt-4">
      <p role="status" className="text-ink-2 text-[14px]">
        {state === "answering" ? "Your message is saved. The assistant is still answering." : "Your message is saved. The reply did not finish."}
      </p>
      {state === "interrupted" ? <Button variant="secondary" className="mt-3" onClick={onContinue}>Continue reply</Button> : null}
    </div>
  );
}
