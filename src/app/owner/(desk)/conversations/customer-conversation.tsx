"use client";
import { customerLabel } from "@/lib/customer-label";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Textarea } from "@/components/arc/textarea/textarea";
import {
  AssistantAnswer,
  ShopConversation,
} from "@/components/assistant/conversation";
import { conversationText, sellerReplyOf } from "@/lib/conversation-messages";
import { Message } from "@/components/assistant/message";
import type { SellerConversation } from "@/server/domain/conversation-messages";
import {
  controlConversationAction,
  refreshConversationAction,
  replyToConversationAction,
} from "./actions";

/**
 * The one-line state under a conversation's title, matching the inbox label: a question the
 * assistant handed to the owner comes first, because that is what the owner has to act on.
 */
export function conversationStatus({ ownerReplying, waitingOnOwner }: { ownerReplying: boolean; waitingOnOwner: boolean }): string {
  if (ownerReplying) return "You’re replying. The assistant is paused.";
  if (waitingOnOwner) return "Waiting for your answer. The assistant told the customer it asked you.";
  return "The assistant is handling this conversation.";
}

/** One customer conversation with deliberate human ownership and exact-word replies. */
export function CustomerConversation({
  initial,
  readOnly = false,
}: {
  initial: SellerConversation;
  /** A demo visitor reads the conversation; taking over and replying are the owner's. */
  readOnly?: boolean;
}) {
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState("");
  const [answerPending, setAnswerPending] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const nonce = useRef<string | null>(null);
  const request = useRef(0);
  const replyField = useRef<HTMLTextAreaElement>(null);
  const accept = useCallback((next: SellerConversation) => {
    setView((current) =>
      next.control.revision < current.control.revision ? current : next,
    );
    // A read can prove delivery after the mutation response was lost. Only the
    // current unchanged draft's server-authored message may acknowledge it.
    if (
      nonce.current &&
      next.messages.some(
        (message) => message.id === nonce.current && sellerReplyOf(message),
      )
    ) {
      nonce.current = null;
      setDraft("");
      setAnswerPending(null);
      setSent(true);
      setProblem(null);
    }
  }, []);
  const refresh = useCallback(async () => {
    const serial = ++request.current;
    const result = await refreshConversationAction({ id: initial.control.id });
    if (serial !== request.current) return;
    if (result?.data) {
      accept(result.data);
      setRefreshProblem(null);
    } else
      setRefreshProblem(
        result?.serverError ??
          "Could not refresh this conversation. Your draft is still here.",
      );
  }, [initial.control.id, accept]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!stopped && document.visibilityState === "visible") await refresh();
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ++request.current;
    };
  }, [refresh]);
  const control = useAction(controlConversationAction, {
    onSuccess: ({ data }) => {
      ++request.current;
      if (data) accept(data);
      setProblem(null);
      setSent(false);
      if (data?.control.handler === "seller")
        requestAnimationFrame(() => replyField.current?.focus());
    },
    onError: ({ error }) => {
      setProblem(
        error.serverError ??
          "Could not switch who replies. Refresh to see who is replying now.",
      );
      void refresh();
    },
  });
  const reply = useAction(replyToConversationAction, {
    onSuccess: ({ data }) => {
      ++request.current;
      if (data) accept(data);
      setDraft("");
      nonce.current = null;
      setAnswerPending(null);
      setSent(true);
      setProblem(null);
    },
    onError: ({ error }) => {
      setProblem(
        error.serverError ??
          "Could not confirm delivery. Your draft is kept while we check the conversation.",
      );
      void refresh();
    },
  });
  const human = view.control.handler === "seller";
  const busy = control.isPending || reply.isPending;
  const selectionChanged = Boolean(
    answerPending &&
      (answerPending.id !== view.pending?.id ||
        answerPending.revision !== view.pending?.revision),
  );
  return (
    <section
      className="flex min-h-[65dvh] min-w-0 flex-col lg:border-l lg:border-line lg:pl-7"
      aria-label="Selected customer conversation"
    >
      <Link
        href="/owner/conversations"
        className="mb-4 inline-flex min-h-11 items-center gap-2 self-start text-[14px] text-ink-2 lg:hidden"
      >
        <ArrowLeft size={16} aria-hidden />
        Conversations
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
            {customerLabel(view.control.id)}
          </h2>
          <p role="status" className="mt-1 text-[14px] text-ink-2">
            {conversationStatus({ ownerReplying: human, waitingOnOwner: Boolean(view.pending) })}
          </p>
        </div>
        {readOnly ? null : <Button
          variant={human ? "secondary" : "primary"}
          loading={control.isPending}
          disabled={reply.isPending}
          onClick={() =>
            control.execute({
              id: view.control.id,
              expectedRevision: view.control.revision,
              handler: human ? "assistant" : "seller",
            })
          }
        >
          {human ? "Return to assistant" : "Take over"}
        </Button>}
      </header>
      <div className="min-h-0 flex-1 py-6">
        <ShopConversation shopName="Customer">
          <ol className="chat-list" aria-label="Conversation history">
            {view.messages.map((message) => {
              const text = conversationText(message);
              if (!text) return null;
              const sellerReply = sellerReplyOf(message);
              // As in the shop: the customer (the AI SDK user) sits at the end in a bubble; the shop side, assistant or owner, at the start.
              return (
                <li key={message.id} className="min-w-0">
                  {sellerReply ? (
                    <Message variant="card" label="You">{text}</Message>
                  ) : message.role === "user" ? (
                    <Message variant="bubble" align="end" label="Customer">{text}</Message>
                  ) : (
                    <Message variant="answer" label="AI assistant"><AssistantAnswer text={text} streaming={false} /></Message>
                  )}
                </li>
              );
            })}
          </ol>
        </ShopConversation>
      </div>
      <div className="border-t border-line pt-4">
        {view.pending ? (
          <div className="mb-4 text-[14px]">
            <p className="font-semibold">Open question</p>
            <p className="mt-1 text-ink-2">{view.pending.question}</p>
          </div>
        ) : null}
        {human && !readOnly ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim() || busy || selectionChanged) return;
              nonce.current ??= crypto.randomUUID();
              reply.execute({
                id: nonce.current,
                conversationId: view.control.id,
                expectedRevision: view.control.revision,
                text: draft,
                ...(answerPending ? { answerPending } : {}),
              });
            }}
          >
            <Textarea
              label="Your reply to the customer"
              ref={replyField}
              id="seller-direct-reply"
              rows={3}
              maxLength={4000}
              value={draft}
              disabled={reply.isPending}
              placeholder="Write as yourself. The customer sees your exact words."
              onChange={(event) => {
                setDraft(event.target.value);
                nonce.current = null;
                setSent(false);
              }}
            />
            {view.pending || answerPending ? (
              <Checkbox
                checked={Boolean(answerPending)}
                disabled={busy}
                onCheckedChange={(checked) => {
                  setAnswerPending(
                    checked === true && view.pending
                      ? { id: view.pending.id, revision: view.pending.revision }
                      : null,
                  );
                  nonce.current = null;
                }}
                label="This also answers the open question above"
              />
            ) : null}
            {selectionChanged ? (
              <p role="alert" className="mt-2 text-[14px] text-ink-2">
                The request changed. Review it and select the checkbox again, or
                uncheck it to send only your reply.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                loading={reply.isPending}
                disabled={
                  control.isPending || !draft.trim() || selectionChanged
                }
              >
                Send reply
              </Button>
              {sent ? (
                <span role="status" className="text-[14px] text-ink-2">
                  Reply saved for the customer.
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[12px] text-ink-3">
              Quotes and payments still need their separate approvals.
            </p>
          </form>
        ) : (
          <p className="text-[14px] text-ink-2">
            {readOnly
              ? "The owner can take over here and reply in their own words, then hand the conversation back to the assistant."
              : "Take over to reply yourself. Returning control lets the assistant answer the customer’s next message."}
          </p>
        )}
        {problem || refreshProblem ? (
          <Alert
            tone="danger"
            className="mt-3"
            title={problem ?? refreshProblem ?? ""}
          >
            <Button
              type="button"
              variant="ghost"
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
