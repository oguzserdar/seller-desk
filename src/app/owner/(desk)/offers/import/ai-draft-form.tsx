"use client";

import { ChoiceSelect } from "@/components/choice-select";
import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import { useId, useState } from "react";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Button } from "@/components/arc/button/button";
import { cx } from "@/lib/cx";
import { Alert } from "@/components/arc/alert/alert";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatMoney } from "@/lib/money";
import type { DraftView } from "@/server/ai/draft-setup";
import type { DraftOffer, OfferKind } from "@/server/db/types";
import { addDraftsAction, draftFromTextAction } from "../actions";

const KIND_WORDS: Record<OfferKind, string> = {
  goods: "Pickup item",
  service: "Service",
  digital: "Download",
};

type Choice = { include: boolean; kind: OfferKind };

/** The distinct passages of the owner's text this draft was built from. */
function quotesOf(draft: DraftOffer): string[] {
  const quotes = [
    draft.title,
    draft.priceMinor,
    draft.stock,
    draft.description,
    draft.serviceScope,
  ]
    .map((field) => field.evidence?.quote)
    .filter((quote): quote is string => Boolean(quote));
  return quotes
    .filter(
      (quote, index) =>
        !quotes.some(
          (other, j) =>
            j !== index && other.length > quote.length && other.includes(quote),
        ) && quotes.indexOf(quote) === index,
    )
    .slice(0, 3);
}

function gapsOf(draft: DraftOffer, kind: OfferKind): string[] {
  const gaps: string[] = [];
  if (draft.priceMinor.status === "unknown")
    gaps.push("No exact price could be confirmed");
  if (draft.description.status === "unknown") gaps.push("No description");
  if (kind === "goods" && draft.stock.status === "unknown")
    gaps.push("No stock count");
  if (kind === "service" && draft.serviceScope.status === "unknown")
    gaps.push("No scope of work");
  return gaps;
}

function DraftRow({
  draft,
  currency,
  choice,
  onChange,
}: {
  draft: DraftOffer;
  currency: string;
  choice: Choice;
  onChange: (next: Choice) => void;
}) {
  const usable = draft.title.value !== null && draft.priceMinor.value !== null;
  const boxId = useId();
  const quotes = quotesOf(draft);
  const gaps = gapsOf(draft, choice.kind);
  return (
    <li
      className={cx(
        "bg-surface border-line rounded-[14px] border p-4",
        !usable && "opacity-80",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id={boxId}
          checked={usable && choice.include}
          disabled={!usable}
          onCheckedChange={(checked) =>
            onChange({ ...choice, include: checked === true })
          }
          aria-labelledby={`${boxId}-title`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <label
              htmlFor={boxId}
              id={`${boxId}-title`}
              className="text-[17px] font-semibold"
            >
              {draft.title.value ?? "Unnamed offer"}
            </label>
            <span className="tabular text-[16px] font-semibold">
              {draft.priceMinor.value !== null
                ? formatMoney(draft.priceMinor.value, currency)
                : "No price"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
            <ChoiceSelect
              id={`${boxId}-kind`}
              label="Suggested type"
              value={choice.kind}
              onValueChange={(next) =>
                onChange({ ...choice, kind: next as OfferKind })
              }
              options={(Object.keys(KIND_WORDS) as OfferKind[]).map((kind) => ({
                value: kind,
                label: KIND_WORDS[kind],
              }))}
            />
            {draft.stock.value !== null && choice.kind === "goods" ? (
              <span className="text-ink-2">{draft.stock.value} in stock</span>
            ) : null}
          </div>
          {quotes.length > 0 ? (
            <div className="mt-3">
              <p className="text-ink-3 text-[13px] font-medium">
                From your text
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {quotes.map((quote) => (
                  <li
                    key={quote}
                    className="text-ink-2 text-[14px] leading-snug"
                  >
                    &ldquo;{quote}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {gaps.length > 0 ? (
            <p className="text-attention mt-2 text-[13px]">
              {gaps.join(". ")}.
            </p>
          ) : null}
          {!usable ? (
            <p className="text-ink-3 mt-1 text-[13px]">
              Needs a name and a price from your text before it can be added.
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Drafts offers from a description the owner writes, with every kept fact quoted back from it. */
export function AiDraftForm({
  modelReady,
  currency,
}: {
  modelReady: boolean;
  currency: string;
}) {
  const textId = useId();
  const [text, setText] = useState("");
  const [view, setView] = useState<DraftView | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [added, setAdded] = useState<number | null>(null);
  const draft = useAction(draftFromTextAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setView(data);
      setAdded(null);
      setChoices(
        Object.fromEntries(
          data.drafts.map((item) => [
            item.key,
            { include: item.include, kind: item.kind.value ?? "goods" },
          ]),
        ),
      );
    },
  });
  const add = useAction(addDraftsAction, {
    onSuccess: ({ data }) => setAdded(data?.created ?? 0),
  });

  const ready = view
    ? view.drafts.filter(
        (item) =>
          item.title.value !== null &&
          item.priceMinor.value !== null &&
          choices[item.key]?.include,
      )
    : [];

  return (
    <section aria-labelledby="describe-heading" className="mt-8">
      <h2
        id="describe-heading"
        className="text-[22px] font-semibold tracking-[-0.015em]"
      >
        Describe what you sell
      </h2>
      <p className="text-ink-2 mt-1 text-[16px]">
        Write it the way you would tell a customer. The AI drafts offers and
        shows the words it used from your text. Check each one belongs to the
        right offer, and confirm the suggested type. Nothing is published until you
        publish it.
      </p>
      {!modelReady ? (
        <Alert
          tone="warning"
          className="mt-4"
          title="Drafting needs a connected AI model."
        >
          <Link href="/owner/setup" className="font-semibold underline">
            Connect one in Setup
          </Link>
          , or paste a price list below.
        </Alert>
      ) : null}
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          draft.execute({ text });
        }}
      >
        <Textarea
          label="What you sell"
          id={textId}
          rows={6}
          maxLength={8000}
          value={text}
          disabled={!modelReady}
          onChange={(event) => setText(event.target.value)}
          placeholder="For example: Desk lamp $49, plug-in, 3 in stock. Rechargeable lamp $69. Lamp repairs from $30, I look at it first. Pickup Tuesday to Saturday."
        />
        <Button
          type="submit"
          className="self-start"
          disabled={!modelReady || text.trim().length < 10}
          loading={draft.isPending}
        >
          Draft my offers
        </Button>
      </form>
      {draft.result.serverError ? (
        <Alert
          tone="danger"
          className="mt-3"
          title={draft.result.serverError}
        />
      ) : null}

      {view ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[17px] font-semibold">
              {view.drafts.length === 0
                ? "No offers found in your text"
                : `${view.drafts.length} draft${view.drafts.length === 1 ? "" : "s"} from your text`}
            </h3>
            <span className="text-ink-3 text-[13px]">
              Drafted by {view.generator.split(":").slice(1).join(":")}
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-3">
            {view.drafts.map((item) => (
              <DraftRow
                key={item.key}
                draft={item}
                currency={currency}
                choice={
                  choices[item.key] ?? {
                    include: item.include,
                    kind: item.kind.value ?? "goods",
                  }
                }
                onChange={(next) =>
                  setChoices((current) => ({ ...current, [item.key]: next }))
                }
              />
            ))}
          </ul>
          {view.missing.length > 0 ? (
            <div className="mt-4">
              <p className="text-[15px] font-semibold">
                Your text does not say
              </p>
              <ul className="text-ink-2 mt-1 list-disc pl-5 text-[15px]">
                {view.missing.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {added !== null ? (
            <Alert
              tone="success"
              className="mt-4"
              title={`${added} draft${added === 1 ? "" : "s"} added, unpublished.`}
            >
              <Link href="/owner/offers" className="font-semibold underline">
                Finish and publish them in Offers
              </Link>
            </Alert>
          ) : (
            <Button
              className="mt-4"
              disabled={ready.length === 0}
              loading={add.isPending}
              onClick={() =>
                add.execute({
                  draftId: view.draftId,
                  reviewRevision: view.reviewRevision,
                  choices: view.drafts.map((item) => ({
                    key: item.key,
                    include: choices[item.key]?.include ?? false,
                    kind: choices[item.key]?.kind ?? item.kind.value ?? "goods",
                  })),
                })
              }
            >
              {ready.length === 0
                ? "Add drafts"
                : `Add ${ready.length} draft${ready.length === 1 ? "" : "s"}`}
            </Button>
          )}
          {add.result.serverError ? (
            <Alert
              tone="danger"
              className="mt-3"
              title={add.result.serverError}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
