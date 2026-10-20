"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleCheck } from "lucide-react";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Textarea } from "@/components/arc/textarea/textarea";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { OfferPhoto } from "@/components/buyer/offer-tile";
import { LinkButton } from "@/components/link-button";
import { GraduationCap } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { needsYouLabel } from "@/server/domain/desk-count";
import { answerQuestionAction } from "../actions";
import type { CustomerQuestion } from "../customer-questions";

/** An order that waits on the owner, as one Desk row. */
export type NeedsYouOrder = { id: string; ref: string; items: string; amount: string; nextStep: string; imagePath: string | null; href: string };

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const enter = { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } as const;

function QuestionCard({ item }: { item: CustomerQuestion }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [answer, setAnswer] = useState("");
  const [sentAt, setSentAt] = useState<string | null>(null);
  const send = useAction(answerQuestionAction, {
    onSuccess: () => {
      setSentAt(TIME.format(new Date()));
      router.refresh();
    },
  });
  const details = [item.customerGoal, ...item.knownFacts].filter((line) => line.trim().length > 0);
  return (
    <li data-needs-you-item className="surface">
      <AnimatePresence mode="popLayout" initial={false}>
        {sentAt ? (
          <motion.p key="sent" role="status" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={enter} className="text-ink-2 flex items-center gap-2.5 px-5 py-4 text-[15px]">
            <CircleCheck aria-hidden className="text-success size-[18px] shrink-0" />
            Sent to the customer at {sentAt}. The assistant continues the conversation.
          </motion.p>
        ) : (
          <motion.form
            key="ask"
            exit={reduce ? undefined : { opacity: 0, y: -6, transition: { duration: motionTokens.duration.fast } }}
            className="p-5"
            onSubmit={(event) => {
              event.preventDefault();
              send.execute({ questionId: item.id, expectedRevision: item.revision, answer });
            }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="bg-attention-soft text-attention rounded-[6px] px-2 py-0.5 text-[12px] font-semibold">Your assistant needs an answer</h3>
              <p className="text-ink-3 flex items-baseline gap-3 text-[13px]">
                <time className="tabular" dateTime={item.askedAt}>{TIME.format(new Date(item.askedAt))}</time>
                <Link href={`/owner/conversations?conversation=${item.conversationId}`} className="text-ink-2 decoration-line-strong font-medium underline underline-offset-4 hover:text-ink">Open conversation</Link>
              </p>
            </div>
            <p className="mt-3 max-w-[60ch] text-[20px] leading-snug font-semibold tracking-[-0.01em]">{item.question}</p>
            {details.length ? (
              <ul aria-label="What the customer told the assistant" className="bg-sunken divide-line mt-4 flex flex-col divide-y rounded-[10px] px-4 text-[15px]">
                {details.map((line, index) => (
                  <li key={`${index}-${line}`} data-detail className="py-2.5">{line}</li>
                ))}
              </ul>
            ) : null}
            {item.quoteReviewId ? (
              <Link href={`/owner/quotes/${item.quoteReviewId}`} className="text-ink decoration-line-strong mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4">
                Review quote and answer together
              </Link>
            ) : null}
            <div className="mt-4">
              <Textarea label="Your answer to the customer" rows={3} maxLength={1000} value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink-3 text-[13px]">The assistant passes on your words. It promises nothing more.</p>
              <Button type="submit" variant="primary" loading={send.isPending} disabled={answer.trim().length === 0}>
                Send to customer
              </Button>
            </div>
            {send.result.serverError ? (
              <Alert tone="danger" className="mt-3" title={send.result.serverError} />
            ) : null}
          </motion.form>
        )}
      </AnimatePresence>
    </li>
  );
}

function OrderRow({ order }: { order: NeedsYouOrder }) {
  return (
    <li data-needs-you-item className="surface flex items-center gap-4 px-4 py-3">
      <OfferPhoto offer={{ title: order.items, imagePath: order.imagePath }} sizes="44px" className="size-11 shrink-0 rounded-[8px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">
          {order.items}
          <span className="text-ink-3 ml-2 font-normal">{order.ref}</span>
          <span className="tabular text-ink-3 ml-2 font-normal">{order.amount}</span>
        </p>
        <p className="text-ink-2 text-[13px]">{order.nextStep}</p>
      </div>
      <LinkButton href={order.href} variant="secondary" size="sm">Open</LinkButton>
    </li>
  );
}

/** Everything that waits on the owner, under one count: customer questions first, then orders. */
export function NeedsYou({ questions, orders }: { questions: CustomerQuestion[]; orders: NeedsYouOrder[] }) {
  const count = questions.length + orders.length;
  return (
    <section aria-label={`Needs you: ${count}`} className="mt-8">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        Needs you
        <Badge tone={count ? "warning" : "neutral"} size="sm" className="tabular">{count}</Badge>
      </h2>
      {count === 0 ? (
        <p className="text-ink-2 mt-3 text-[15px]">{needsYouLabel(0)}. New questions and orders that need you appear here.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {questions.map((item) => <QuestionCard key={item.id} item={item} />)}
          {orders.map((order) => <OrderRow key={order.id} order={order} />)}
        </ul>
      )}
    </section>
  );
}

/** Answers the owner already gave can become shop facts; this is the way in, shown only when there is something to review. */
export function TeachCard({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <section aria-label="Teach your assistant" className="surface mt-4 flex flex-wrap items-center gap-4 px-5 py-4">
      <span aria-hidden className="bg-sunken text-ink grid size-10 shrink-0 place-items-center rounded-[10px]"><GraduationCap className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold">Teach your assistant</h2>
        <p className="text-ink-2 text-[14px]">{count === 1 ? "One answer you gave a customer" : `${count} answers you gave customers`} can become facts the next customer gets straight away.</p>
      </div>
      <LinkButton href="/owner/knowledge/reviews" variant="primary">Review {count === 1 ? "1 answer" : `${count} answers`}</LinkButton>
    </section>
  );
}
