"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import { setAssistantDraftsAction } from "./actions";
import { ConnectorAnswersSwitch } from "./connector-answers-switch";

/**
 * Who answers a customer's waiting question: only the owner, or the assistant drafts and the owner
 * approves. Connected AI apps can also step in. Every answer sent is drafted as shop knowledge.
 */
export function AnswerSettings({ drafts, mayAnswer, readOnly }: { drafts: boolean; mayAnswer: boolean; readOnly: boolean }) {
  const [mode, setMode] = useState(drafts ? "draft" : "owner");
  const save = useAction(setAssistantDraftsAction, {
    onSuccess: ({ data }) => { if (data) setMode(data.on ? "draft" : "owner"); },
    onError: () => setMode(drafts ? "draft" : "owner"),
  });
  return (
    <section id="answers" aria-labelledby="answers-heading" className="surface mt-8 scroll-mt-40 sm:scroll-mt-28 px-5 py-6 sm:px-6">
      <h2 id="answers-heading" className="text-[22px] font-semibold">Who answers customers&apos; waiting questions</h2>
      <p className="text-ink-2 mt-1 text-[15px]">
        Your assistant answers everything your shop knowledge covers. When a customer asks something it does not know, the question waits on your desk.
      </p>
      <RadioCards
        aria-label="Who answers waiting questions"
        className="mt-5"
        layout="list"
        value={mode}
        disabled={readOnly || save.isPending}
        onValueChange={(next) => { setMode(next); save.execute({ on: next === "draft" }); }}
        options={[
          { value: "owner", label: "Only me", description: "I write every reply on the desk." },
          { value: "draft", label: "My assistant drafts, I approve", description: "Help me write fills your answer from your shop knowledge, terms and catalog. Anything your shop has not said is left as a [[blank]] for you to fill in before you send." },
        ]}
      />
      {save.result.serverError ? <p role="alert" className="text-danger mt-2 text-[13px]">{save.result.serverError}</p> : null}
      <ConnectorAnswersSwitch allowed={mayAnswer} readOnly={readOnly} />
      <p className="text-ink-2 mt-4 text-[14px]">
        Every answer you send, however you send it, is drafted as shop knowledge. Approve it once in Knowledge, and the assistant gives that answer to the next customer itself.
      </p>
    </section>
  );
}
