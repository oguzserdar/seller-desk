import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getAssistantModel } from "@/server/ai/registry";
import { requireOwner } from "@/server/auth/owner";
import {
  DESK_VIEW_LABEL,
  DESK_VIEWS,
  type DeskView,
  queryDesk,
} from "@/server/domain/desk";
import { openQuestions } from "@/server/domain/seller-questions";
import { listQuotesAwaitingReview } from "@/server/domain/quotes";
import type { CustomerQuestion } from "../customer-questions";
import { NeedsYou, TeachCard, type NeedsYouOrder } from "./needs-you";
import { answersToTeach } from "@/server/domain/learning-review";
import { loadOwnerHistory } from "@/server/ai/owner-conversation";
import { DeskChatProvider } from "../desk-chat-context";
import { DeskAssistant } from "../desk-assistant";
import { MobileAssistant } from "../mobile-assistant";
import { DeskGrid } from "./desk-grid";
import { assistantDraftsAnswers } from "@/server/domain/connector-settings";
import { ViewSelect } from "./view-select";

export const metadata: Metadata = { title: "Desk" };

const MORE_VIEWS: DeskView[] = [
  "all_orders",
  "pickup_pending",
  "service_followup",
  "access_failed",
  "payments_uncertain",
  "quotes_awaiting_review",
  "completed",
];

export default async function DeskPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { owner, viewer } = await requireOwner(await headers());
  const requested = (await searchParams).view;
  const view: DeskView =
    (DESK_VIEWS as readonly string[]).includes(requested ?? "") &&
    requested !== "needs_attention"
      ? (requested as DeskView)
      : "all_orders";
  const [result, attention, questions, history, quotesToReview, toTeach, drafts] =
    await Promise.all([
      queryDesk(owner, { view }),
      queryDesk(owner, { view: "needs_attention" }),
      openQuestions(owner),
      loadOwnerHistory(owner),
      listQuotesAwaitingReview(owner),
      answersToTeach(owner),
      assistantDraftsAnswers(),
    ]);
  const allOrders =
    view === "all_orders"
      ? result
      : await queryDesk(owner, { view: "all_orders" });
  const paid = allOrders.totals[0];
  const decisions: CustomerQuestion[] = questions.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    revision: row.revision,
    question: row.question,
    customerGoal: row.customerGoal,
    knownFacts: row.knownFacts,
    askedAt: row.createdAt.toISOString(),
    quoteReviewId: quotesToReview.find(
      (item) => item.buyerSessionId === row.buyerSessionId,
    )?.id,
  }));
  // The desk assistant spends the shop's AI budget, so a demo visitor does not get it.
  const assistantOn = !viewer && (await getAssistantModel()).ok;
  const ordersNeedingYou: NeedsYouOrder[] = attention.rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    items: row.items,
    amount: row.amount,
    nextStep: row.nextStep,
    imagePath: row.imagePath,
    href: row.href,
  }));
  const waiting = ordersNeedingYou.length + decisions.length;

  return (
    <DeskChatProvider history={history}>
      <div
        className={
          assistantOn
            ? "lg:grid lg:grid-cols-[minmax(0,1fr)_400px]"
            : "mx-auto max-w-6xl"
        }
      >
        <section className="min-w-0 px-4 pt-8 pb-28 sm:px-8 lg:pb-12">
          {/* The "Needs you" figure below carries the count; the heading does not repeat it. */}
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
            Desk
          </h1>
          {viewer ? (
            <p className="text-ink-2 mt-3 text-[14px]">
              A read-only look at this shop&apos;s desk. After signing in, the owner asks their own assistant about orders here.
            </p>
          ) : !assistantOn ? (
            <p className="text-ink-2 mt-3 text-[14px]">
              Your assistant isn&apos;t connected yet.{" "}
              <Link
                href="/owner/setup#assistant"
                className="text-ink font-medium underline underline-offset-4"
              >
                Connect your assistant
              </Link>{" "}
              when you&apos;re ready.
            </p>
          ) : null}
          <dl className="divide-line border-line mt-6 grid grid-cols-3 divide-x border-y py-5">
            <div className="pr-4">
              <dt className="text-ink-2 min-h-10 text-[13px] font-medium sm:min-h-0">
                Paid orders
              </dt>
              <dd className="mt-2">
                <span className="tabular text-[28px] font-semibold leading-none">
                  {paid?.paidOrders ?? 0}
                </span>
                <span className="text-ink-3 mt-2 block text-[12px]">
                  {paid?.paidLabel ?? "None yet"}
                </span>
              </dd>
            </div>
            <div className="px-4">
              <dt className="text-ink-2 min-h-10 text-[13px] font-medium sm:min-h-0">
                Needs you
              </dt>
              <dd className="mt-2">
                <span className="tabular text-[28px] font-semibold leading-none">
                  {waiting}
                </span>
                <span className="text-ink-3 mt-2 block text-[12px]">
                  {waiting ? "Waiting on you" : "All caught up"}
                </span>
              </dd>
            </div>
            <div className="pl-4">
              <dt className="text-ink-2 min-h-10 text-[13px] font-medium sm:min-h-0">
                Answers to teach
              </dt>
              <dd className="mt-2">
                <span className="tabular text-[28px] font-semibold leading-none">
                  {toTeach}
                </span>
                <span className="text-ink-3 mt-2 block text-[12px]">
                  {toTeach ? "Ready to review" : "None yet"}
                </span>
              </dd>
            </div>
          </dl>
          {waiting > 0 ? (
            <NeedsYou questions={decisions} orders={ordersNeedingYou} readOnly={viewer} drafts={drafts} />
          ) : null}
          <TeachCard count={toTeach} />
          <div className="mt-12 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              {view === "all_orders" ? "All orders" : DESK_VIEW_LABEL[view]}
              <span className="tabular text-ink-3 font-normal">
                {result.counts[view]}
              </span>
            </h2>
            <div className="flex items-center gap-3">
              <ViewSelect
                current={view}
                options={MORE_VIEWS.map((item) => ({
                  value: item,
                  label: DESK_VIEW_LABEL[item],
                  count: result.counts[item],
                }))}
              />
            </div>
          </div>
          <div className="mt-4">
            <DeskGrid rows={result.rows} viewLabel={DESK_VIEW_LABEL[view]} />
          </div>
          {result.totals.length > 0 ? (
            <p
              className="text-ink-2 mt-4 text-[14px]"
              aria-label="Paid totals in this view"
            >
              {result.totals.map((total) => (
                <span key={total.currency} className="tabular mr-4">
                  Paid in this view:{" "}
                  <strong className="text-ink font-semibold">
                    {total.paidLabel}
                  </strong>{" "}
                  from {total.paidOrders} order
                  {total.paidOrders === 1 ? "" : "s"}
                </span>
              ))}
            </p>
          ) : null}
        </section>
        {assistantOn ? (
          <aside
            aria-label="Ask your desk"
            className="border-line bg-surface hidden border-l lg:block"
          >
            <div className="sticky top-0 flex h-[calc(100dvh-var(--banner-h,0px)-3.5rem)] flex-col px-6 pt-8 pb-6">
              <DeskAssistant assistantOn={assistantOn} className="h-full" />
            </div>
          </aside>
        ) : null}
        {assistantOn ? <MobileAssistant assistantOn={assistantOn} /> : null}
      </div>
    </DeskChatProvider>
  );
}
