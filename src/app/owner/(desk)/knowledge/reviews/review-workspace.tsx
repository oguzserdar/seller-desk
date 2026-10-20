"use client";
import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { ArrowRight, LockKeyhole, MessageSquareText } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/arc/badge/badge";
import { cx } from "@/lib/cx";
import { Alert } from "@/components/arc/alert/alert";
import type {
  LearningAnalysis,
  LearningWorkspaceItem,
} from "@/lib/learning-review";
import { decideReviewAction, generateReviewAction } from "./actions";
import type { LearningPreviewView } from "@/lib/learning-preview";
import { PreviewFinding } from "./preview-finding";
import { PublishFinding } from "./publish-finding";
import { EmptyState } from "@/components/arc/empty-state/empty-state";

const KIND_LABELS = {
  reusable_fact: "General shop fact",
  product_rule: "Product rule",
  customer_exception: "This customer only",
  temporary_information: "Temporary information",
  missing_integration: "Connection needed",
  app_failure: "Something to fix",
  unclear: "Needs clarification",
};
/** Findings read in the order the owner acts on them: what customers will hear, what stays private, what needs fixing. */
const FINDING_GROUPS: {
  title: string;
  kinds: readonly LearningAnalysis["findings"][number]["kind"][];
  private?: boolean;
}[] = [
  {
    title: "The next customer will be told",
    kinds: ["reusable_fact", "product_rule", "temporary_information"],
  },
  {
    title: "Stays between you and this customer",
    kinds: ["customer_exception"],
    private: true,
  },
  {
    title: "Needs your attention",
    kinds: ["missing_integration", "app_failure", "unclear"],
  },
];
const STATE_LABELS = {
  draft: "Ready to review",
  deferred: "Saved for later",
  rejected: "Discarded",
};

function Finding({
  finding,
  source,
  approved,
  children,
}: {
  finding: LearningAnalysis["findings"][number];
  source: NonNullable<LearningWorkspaceItem["review"]>["source"];
  approved: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="border-line border-t py-6 first:border-t-0 first:pt-0">
      <Badge
        tone={finding.kind === "customer_exception" ? "warning" : "neutral"}
      >
        {KIND_LABELS[finding.kind]}
      </Badge>
      {!approved && finding.proposedFact ? (
        <p className="text-ink-3 mt-3 text-[13px] font-medium">
          {finding.title} · suggested wording, not published
        </p>
      ) : null}
      <h3
        className={cx(
          "text-[19px] leading-snug font-semibold tracking-tight",
          !approved && finding.proposedFact ? "mt-1" : "mt-3",
        )}
      >
        {!approved && finding.proposedFact
          ? finding.proposedFact
          : finding.title}
      </h3>
      <p className="text-ink-2 mt-1 text-[15px] leading-relaxed">
        {finding.explanation}
      </p>
      <blockquote className="border-line-strong text-ink-2 mt-4 border-l-2 pl-4 text-[14px] leading-relaxed">
        “{finding.answerQuote}”
        <span className="text-ink-3 mt-1 block text-[12px] not-italic">
          From your answer
        </span>
      </blockquote>
      <p className="mt-4 text-[14px] leading-relaxed">
        <span className="font-semibold">Applies to: </span>
        {finding.scope}
      </p>
      {!approved && finding.conflictingGuideIds.length ? (
        <div className="mt-4">
          <p className="text-attention text-[14px] font-semibold">
            Conflicts with published knowledge
          </p>
          {finding.conflictingGuideIds.map((id) => {
            const guide = source.guides.find((item) => item.id === id);
            return guide ? (
              <div key={id} className="mt-2 text-[14px]">
                <p className="font-semibold">{guide.title}</p>
                <p className="text-ink-2 mt-1">{guide.body}</p>
              </div>
            ) : null;
          })}
        </div>
      ) : null}
      {!approved && finding.questions.length ? (
        <div className="mt-4">
          <p className="text-[14px] font-semibold">Still needs your answer</p>
          <ul className="text-ink-2 mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed">
            {finding.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {children}
    </li>
  );
}

function AnswerReview({
  item,
  modelConnected,
  products,
  previews,
}: {
  previews: LearningPreviewView[];
  item: LearningWorkspaceItem;
  modelConnected: boolean;
  products: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const generate = useAction(generateReviewAction, {
    onSuccess: () => {
      setNotice("Review saved. Your customer answers have not changed.");
      router.refresh();
    },
  });
  const decide = useAction(decideReviewAction, {
    onSuccess: ({ data }) => {
      setNotice(
        data
          ? STATE_LABELS[data.state] + ". Customer answers have not changed."
          : null,
      );
      router.refresh();
    },
  });
  const review = item.review;
  const busy = generate.isPending || decide.isPending;
  const error =
    generate.result.serverError ??
    decide.result.serverError ??
    (generate.result.validationErrors || decide.result.validationErrors
      ? "Reload this answer and try again."
      : null);
  const decision = (state: "draft" | "deferred" | "rejected") => {
    if (review) {
      setNotice(null);
      decide.execute({
        id: review.id,
        expectedRevision: review.revision,
        state,
      });
    }
  };
  return (
    <section
      aria-label="Selected seller answer"
      className="min-w-0 [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold tracking-tight">
          Your saved answer
        </h2>
        <span className="text-ink-3 flex items-center gap-1.5 text-[13px]">
          <LockKeyhole size={14} aria-hidden />
          Private review
        </span>
      </div>
      <div className="border-line mt-5 border-y py-5">
        <p className="text-ink-3 text-[13px] font-medium">Customer asked</p>
        <p className="mt-1.5 text-[15px] leading-relaxed">{item.question}</p>
        <p className="text-ink-3 mt-5 text-[13px] font-medium">You answered</p>
        <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed">
          {item.answer}
        </p>
      </div>
      {notice ? <Alert className="mt-4" tone="success" title={notice} /> : null}
      {error ? <Alert className="mt-4" tone="danger" title={error} /> : null}
      {review?.stale ? (
        <Alert
          className="mt-5"
          tone="warning"
          title={
            "Your answer or published knowledge changed. The findings below refer to the earlier version. Review the current answer before using them."
          }
        />
      ) : null}
      {!review || review.stale ? (
        <div className="mt-6">
          <p className="text-ink-2 mb-4 text-[15px] leading-relaxed">
            The assistant checks for useful facts, one-off exceptions, unclear
            details and conflicts. You decide what happens next.
          </p>
          {modelConnected ? (
            <Button
              disabled={busy}
              loading={generate.isPending}
              onClick={() => {
                setNotice(null);
                generate.execute({ questionId: item.questionId });
              }}
            >
              {review ? "Review current answer" : "Review this answer"}
              <ArrowRight size={16} aria-hidden />
            </Button>
          ) : (
            <Alert title="Connect an AI model to prepare new reviews.">
              Saved reviews remain available.
              <div className="mt-2">
                <LinkButton href="/owner/setup#assistant" variant="ghost">
                  Connect your assistant
                </LinkButton>
              </div>
            </Alert>
          )}
        </div>
      ) : null}
      {review ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[22px] font-semibold tracking-tight">
              What the assistant found
            </h2>
            <Badge>{STATE_LABELS[review.state]}</Badge>
          </div>
          <p className="text-ink-2 mt-2 text-[15px] leading-relaxed">
            {review.analysis.summary}
          </p>
          {review.stale ? (
            <details className="border-line mt-4 border-b pb-4 text-[14px]">
              <summary className="text-brand min-h-11 cursor-pointer py-3 font-semibold">
                Earlier source used for this review
              </summary>
              <p>{review.source.question}</p>
              <blockquote className="border-line-strong mt-3 whitespace-pre-wrap border-l-2 pl-4">
                {review.source.answer}
              </blockquote>
            </details>
          ) : null}
          {FINDING_GROUPS.map((group) => {
            const members = review.analysis.findings
              .map((finding, index) => ({ finding, index }))
              .filter(({ finding }) => group.kinds.includes(finding.kind));
            return members.length ? (
              <section
                key={group.title}
                aria-label={group.title}
                className="mt-8"
              >
                <h3 className="text-ink-2 flex items-center gap-2 text-[13px] font-semibold tracking-[0.04em] uppercase">
                  {group.private ? <LockKeyhole aria-hidden size={14} /> : null}
                  {group.title}
                </h3>
                <ul className="mt-3">
                  {members.map(({ finding, index }) => (
                    <Finding
                      key={`${review.id}-${index}`}
                      finding={finding}
                      source={review.source}
                      approved={review.publications.some(
                        (item) => item.findingIndex === index,
                      )}
                    >
                      <PublishFinding
                        review={review}
                        index={index}
                        products={products}
                      />
                      <PreviewFinding
                        review={review}
                        index={index}
                        modelConnected={modelConnected}
                        reports={previews.filter(
                          (report) =>
                            report.reviewId === review.id &&
                            report.findingIndex === index,
                        )}
                      />
                    </Finding>
                  ))}
                </ul>
              </section>
            ) : null;
          })}
          {!review.analysis.findings.length ? (
            <p className="text-ink-2 py-4">
              No reusable knowledge or follow-up was identified in this answer.
            </p>
          ) : null}
          <div className="border-line mt-2 border-t pt-5">
            <p className="text-ink-2 mb-4 text-[14px] leading-relaxed">
              Only facts you explicitly approve become shop knowledge. Save
              edited wording with Save draft before switching answers or
              deferring this review. Deferring or discarding does not remove
              facts already published.
            </p>
            <div className="flex flex-wrap gap-2">
              {review.state === "draft" ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => decision("deferred")}
                  >
                    Defer review
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => decision("rejected")}
                  >
                    Discard review
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => decision("draft")}
                >
                  Reopen review
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** First use: a labelled example of what a review finds, then the plain empty state. */
function FirstUse() {
  return (
    <div className="mt-8 max-w-3xl">
      <div aria-hidden>
        <p className="text-ink-2 mb-2 text-[13px] font-semibold">
          Example. Nothing is published.
        </p>
        <div className="bg-surface rounded-[12px] p-5 shadow-[0_0_0_1px_var(--color-line)]">
          <p className="text-ink-3 text-[13px] font-medium">
            Brake cable replacement · suggested wording, not published
          </p>
          <p className="mt-1 text-[19px] leading-snug font-semibold">
            A frayed brake cable is replaced for $45, fitted, usually the next
            day.
          </p>
          <p className="text-ink-2 mt-1 text-[15px]">
            You answered this for one customer. The next one could be told
            straight away.
          </p>
          <p className="text-ink-2 border-line-strong mt-4 border-l-2 pl-4 text-[14px]">
            “Yes, $45 fitted, ready Monday.”
            <span className="text-ink-3 mt-1 block text-[12px]">
              From your answer
            </span>
          </p>
        </div>
      </div>
      <EmptyState
        className="mt-2"
        title="No answers to review yet."
        description="Answer a customer from your desk. The parts worth reusing show up here for you to approve."
        icon={<MessageSquareText />}
        action={<LinkButton href="/owner">Answer a customer</LinkButton>}
      />
    </div>
  );
}

/** Bounded owner inbox for real-model findings, with persisted decisions and original evidence. */
export function ReviewWorkspace({
  items,
  modelConnected,
  products,
  previews = [],
}: {
  previews?: LearningPreviewView[];
  items: LearningWorkspaceItem[];
  modelConnected: boolean;
  products: { id: string; title: string }[];
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.questionId ?? null);
  const selected =
    items.find((item) => item.questionId === selectedId) ?? items[0];
  if (!selected) return <FirstUse />;
  return (
    <div className="border-line mt-8 grid border-t lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside
        aria-label="Saved seller answers"
        className="border-line border-b py-5 lg:border-r lg:border-b-0 lg:pr-5"
      >
        <p className="text-ink-3 mb-3 text-[13px]">
          {items.length === 50 ? "Latest 50" : items.length} saved{" "}
          {items.length === 1 ? "answer" : "answers"}
        </p>
        <RadioCards
          aria-label="Saved seller answers"
          layout="list"
          value={selected.questionId}
          onValueChange={setSelectedId}
          options={items.map((item) => ({
            value: item.questionId,
            label: item.question,
            description: item.review
              ? item.review.stale
                ? "Source changed"
                : STATE_LABELS[item.review.state]
              : "Not reviewed",
          }))}
        />
      </aside>
      <div className="min-w-0 py-6 lg:pl-8">
        <AnswerReview
          key={selected.questionId}
          item={selected}
          modelConnected={modelConnected}
          products={products}
          previews={previews}
        />
      </div>
    </div>
  );
}
