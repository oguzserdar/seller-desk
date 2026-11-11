"use client";

/**
 * "Ask your desk": the owner asks in plain words, the assistant reads the desk
 * through fixed views, and at most suggests one action. The action runs only
 * when the owner presses its button, through the same server code as the desk.
 */
import { Message } from "@/components/assistant/message";
import { useChat } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Composer } from "@/components/buyer/composer";
import { OfferPhoto } from "@/components/buyer/offer-tile";
import { Thinking } from "@/components/buyer/thread";
import { AssistantAnswer } from "@/components/assistant/conversation";
import { Button } from "@/components/arc/button/button";
import { cx } from "@/lib/cx";
import { Alert } from "@/components/arc/alert/alert";
import type { ProposalDecision, ProposalView } from "@/server/domain/proposals";
import { useDeskChat } from "./desk-chat-context";
import { decideProposalAction } from "./actions";

type DeskToolRow = {
  id: string;
  ref: string;
  items: string;
  nextStep: string;
  needsOwner: boolean;
  href: string;
  imagePath: string | null;
};

const STARTERS = [
  "What needs me today?",
  "Which downloads failed?",
  "How much was paid today?",
];

function ProposalCard({ proposal }: { proposal: ProposalView }) {
  const router = useRouter();
  const [decision, setDecision] = useState<ProposalDecision | null>(null);
  const decide = useAction(decideProposalAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setDecision(data);
      router.refresh();
    },
  });
  const { history } = useDeskChat();
  const currentDecision = decision ?? history.decisions[proposal.proposalId];
  const pending = decide.isPending;
  return (
    <div className="enter bg-surface border-line rounded-[12px] border p-4">
      <p className="text-[16px] leading-snug font-semibold">
        {proposal.summary}
      </p>
      <p className="text-ink-2 mt-1 text-[14px]">{proposal.consequence}</p>
      {currentDecision ? (
        <p
          role="status"
          className={cx(
            "mt-3 text-[14px] font-semibold",
            currentDecision.state === "executed"
              ? "text-success"
              : currentDecision.state === "failed"
                ? "text-danger"
                : "text-ink-2",
          )}
        >
          {currentDecision.message}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            loading={pending}
            onClick={() =>
              decide.execute({ proposalId: proposal.proposalId, approve: true })
            }
          >
            {proposal.approveLabel}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              decide.execute({
                proposalId: proposal.proposalId,
                approve: false,
              })
            }
          >
            Not now
          </Button>
        </div>
      )}
      {decide.result.serverError ? (
        <Alert
          tone="danger"
          className="mt-3"
          title={decide.result.serverError}
        />
      ) : null}
    </div>
  );
}

function DeskRows({ rows }: { rows: DeskToolRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul
      className="enter flex flex-col gap-1"
      aria-label="Orders from your desk"
    >
      {rows.slice(0, 6).map((row) => (
        <li key={row.id}>
          <Link
            href={row.href}
            className="hover:bg-sunken -mx-2 flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors duration-150"
          >
            <OfferPhoto
              offer={{ title: row.items, imagePath: row.imagePath }}
              sizes="36px"
              className="size-9 shrink-0 rounded-[8px]"
            />
            <span className="min-w-0 flex-1 text-[14px] leading-snug">
              <span className="text-brand font-semibold">{row.ref}</span>{" "}
              <span className="text-ink-2">{row.items}</span>
              <span className="text-ink block truncate">{row.nextStep}</span>
            </span>
          </Link>
        </li>
      ))}
      {rows.length > 6 ? (
        <li className="text-ink-3 text-[13px]">
          and {rows.length - 6} more in the table
        </li>
      ) : null}
    </ul>
  );
}

function ownerChatError(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    return (
      (JSON.parse(error.message) as { message?: string }).message ??
      "The assistant could not answer just now."
    );
  } catch {
    return "The assistant could not answer just now. Nothing was changed.";
  }
}

/** Owner chat; record cards are deliberate tool output and actions require button approval. */
export function DeskAssistant({
  assistantOn,
  className,
  active = true,
}: {
  assistantOn: boolean;
  className?: string;
  active?: boolean;
}) {
  const { chat, history } = useDeskChat();
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    chat,
  });
  // Stopping the stream alone leaves the server's turn claimed until its lease ends; release it too.
  const stopReply = () => {
    void stop();
    void fetch("/api/owner/chat/stop", { method: "POST" });
  };
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = status === "submitted" || status === "streaming";
  const ask = (text: string) => {
    clearError();
    void sendMessage({ text });
  };
  useEffect(() => {
    // The phone dialog becomes visible in its parent effect. Scroll after that layout.
    if (!active) return;
    const frame = requestAnimationFrame(() =>
      endRef.current?.scrollIntoView({ block: "end" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [messages.length, status, active]);

  const last = messages.at(-1);
  const waiting =
    status === "submitted" ||
    (status === "streaming" &&
      last?.role === "assistant" &&
      last.parts.length === 0);
  const problem = ownerChatError(error);

  return (
    <section
      aria-label="Ask your desk"
      className={cx("flex min-h-0 flex-col", className)}
    >
      <h2 className="text-[20px] font-semibold tracking-[-0.01em]">
        Ask your desk
      </h2>
      {history.messages.length ? (
        <p className="text-ink-3 mt-1 text-[13px]">
          Recent conversation saved. Earlier order details may have changed.
        </p>
      ) : null}
      <div
        className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
        role="log"
        aria-label="Desk conversation"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink-2 text-[15px]">
              {assistantOn
                ? "Ask about orders, money or work. It can suggest one action; nothing runs until you press its button."
                : "The desk assistant is off: no AI provider is configured."}
            </p>
            {assistantOn ? (
              <ul className="flex flex-wrap gap-2">
                {STARTERS.map((text) => (
                  <li key={text}>
                    {/* Same suggestion pill as the shop's assistant. */}
                    <button type="button" className="shop-suggestion" onClick={() => ask(text)}>
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="chat-list">
            {messages.map((message) =>
              message.role === "user" ? (
                <Message key={message.id} variant="bubble" align="end">
                  {message.parts
                    .map((part) => (part.type === "text" ? part.text : ""))
                    .join("")}
                </Message>
              ) : (
                <div key={message.id} className="chat-message chat-answer-turn enter">
                  {message.parts.map((part, index) => {
                    if (part.type === "text")
                      return part.text.trim() ? (
                        <AssistantAnswer
                          key={index}
                          text={part.text}
                          streaming={streaming && message.id === last?.id}
                        />
                      ) : null;
                    if (
                      !isToolUIPart(part) ||
                      part.state !== "output-available"
                    )
                      return null;
                    if (part.type === "tool-show_desk_rows") {
                      const rows =
                        (part.output as { rows?: DeskToolRow[] }).rows ?? [];
                      return <DeskRows key={index} rows={rows} />;
                    }
                    if (part.type === "tool-propose_action") {
                      const output = part.output as
                        | ProposalView
                        | { error: string };
                      return "error" in output ? null : (
                        <ProposalCard key={index} proposal={output} />
                      );
                    }
                    return null;
                  })}
                </div>
              ),
            )}
            {waiting ? <Thinking shopName="your desk" /> : null}
            {problem ? <Alert tone="danger" title={problem} /> : null}
            <div ref={endRef} />
          </div>
        )}
      </div>
      {history.interrupted &&
      !streaming &&
      messages.at(-1)?.id === history.messages.at(-1)?.id ? (
        <Alert
          title={
            "Your last question is saved, but the answer did not finish. You can ask again."
          }
        />
      ) : null}
      {history.busyUntil && !streaming ? (
        <p role="status" className="text-ink-2 text-[14px]">
          An answer is still being saved. This conversation will refresh
          shortly.
        </p>
      ) : null}
      <div className="pt-3">
        <Composer
          shopName="your desk"
          onSend={ask}
          onStop={stopReply}
          streaming={streaming}
          disabled={!assistantOn || Boolean(history.busyUntil)}
          placeholder="Ask about your orders"
        />
      </div>
    </section>
  );
}
