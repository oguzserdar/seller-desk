"use client";
import { ChoiceSelect } from "@/components/choice-select";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Button } from "@/components/arc/button/button";
import { LinkButton } from "@/components/link-button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { LearningDraft, SaveLearningDraftInput } from "@/lib/learning-draft";
import { PublishLearningInput } from "@/lib/learning-publication";
import { coveredBy, type LearningWorkspaceItem } from "@/lib/learning-review";
import { GUIDE_LABELS, GUIDE_TOPICS } from "@/lib/shop-guide";
import { publishReviewAction, saveReviewDraftAction } from "./actions";

/** Edited wording is the only text published; evidence and private explanations stay in the review. */
export function PublishFinding({
  review,
  index,
  products,
}: {
  review: NonNullable<LearningWorkspaceItem["review"]>;
  index: number;
  products: { id: string; title: string }[];
}) {
  const id = useId();
  const router = useRouter();
  const [editor, setEditor] = useState<{
    revision: number;
    draft: LearningDraft | undefined;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmedReusable, setConfirmedReusable] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingDraft = useRef<LearningDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publish = useAction(publishReviewAction, {
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
  });
  const save = useAction(saveReviewDraftAction, {
    onSuccess: ({ data }) => {
      if (!data || !pendingDraft.current) return;
      setEditor({ revision: data.revision, draft: pendingDraft.current });
      setDirty(false);
      setSaved(true);
      setError(null);
      setConfirmedReusable(false);
      router.refresh();
    },
  });
  const busy = publish.isPending || save.isPending;
  const finding = review.analysis.findings[index]!;
  const draft = editor?.draft;
  const readDraft = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const expiry = String(data.get("expiry") ?? "");
    const date = expiry ? new Date(expiry) : null;
    return LearningDraft.safeParse({
      findingIndex: index,
      title: data.get("title"),
      body: data.get("body"),
      topic: data.get("topic"),
      productId: data.get("product") || null,
      validUntil:
        date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
      clarification: data.get("clarification") ?? "",
      conflicts: finding.conflictingGuideIds.map((guideId) => ({
        guideId,
        resolution: data.get(`decision-${guideId}`) ?? "",
        reason: data.get(`reason-${guideId}`) ?? "",
      })),
    });
  };
  const approved = review.publications.find(
    (item) => item.findingIndex === index,
  );
  if (approved)
    return (
      <div className="mt-5">
        <Alert
          tone={approved.current ? "success" : "info"}
          title={
            approved.current
              ? "Ready for the next customer"
              : "Saved knowledge has since changed"
          }
        >
          <p className="mt-1">{approved.body}</p>
          <p className="mt-2 text-[13px]">
            Approved as version {approved.guideRevision}. You can edit, remove
            or restore it in shop knowledge.
          </p>
        </Alert>
        <LinkButton href="/owner/knowledge" variant="ghost" className="mt-2">
          Manage this knowledge
        </LinkButton>
      </div>
    );
  if (
    !["reusable_fact", "product_rule", "temporary_information"].includes(
      finding.kind,
    )
  )
    return null;
  if (review.stale || review.state !== "draft") {
    const retained = review.editedDrafts.find((d) => d.findingIndex === index);
    return retained ? (
      <Alert className="mt-5" title="Your saved draft">
        <p className="whitespace-pre-wrap">
          {retained.body || "No public wording entered yet."}
        </p>
        <p className="mt-2 text-[13px]">
          Your edits are kept privately.{" "}
          {review.stale
            ? "Review the changed source before using this wording."
            : "Reopen the review to continue editing."}
        </p>
      </Alert>
    ) : null;
  }
  const covering = coveredBy(finding)
    .map((id) => review.source.guides.find((guide) => guide.id === id))
    .filter((guide) => guide !== undefined);
  if (covering.length)
    return (
      <Alert className="mt-5" title="Already in your shop knowledge">
        <p>
          The assistant already uses this, so there is nothing new to approve.
        </p>
        {covering.map((guide) => (
          <p key={guide.id} className="mt-3">
            <strong>{guide.title}: </strong>
            {guide.body}
          </p>
        ))}
        <div className="mt-3">
          <LinkButton href="/owner/knowledge" variant="secondary">
            Edit shop knowledge
          </LinkButton>
        </div>
      </Alert>
    );
  if (
    finding.conflictingPolicyFields?.length ||
    finding.conflictingProductIds?.length
  )
    return (
      <Alert
        className="mt-5"
        tone="warning"
        title="Resolve the source conflict first"
      >
        <p>
          This fact disagrees with checkout terms or a product listing. Correct
          the source information, then review the answer again.
        </p>
        {finding.conflictingPolicyFields.map((field) => (
          <blockquote key={field} className="mt-3 border-l-2 pl-3">
            {review.source.terms[field]}
          </blockquote>
        ))}
        {finding.conflictingProductIds.map((productId) => {
          const product = review.source.products.find(
            (item) => item.id === productId,
          );
          return product ? (
            <p key={productId} className="mt-3">
              <strong>{product.title}: </strong>
              {product.description}
            </p>
          ) : null;
        })}
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href="/owner/setup" variant="secondary">
            Review checkout terms
          </LinkButton>
          <LinkButton href="/owner/offers" variant="ghost">
            Review products
          </LinkButton>
        </div>
      </Alert>
    );
  if (!editor)
    return (
      <Button
        variant="secondary"
        className="mt-5"
        onClick={() => {
          setEditor({
            revision: review.revision,
            draft: review.editedDrafts.find((d) => d.findingIndex === index),
          });
          setDirty(false);
          setSaved(false);
          setConfirmedReusable(false);
          setError(null);
        }}
      >
        Edit for future customers
      </Button>
    );
  return (
    <form
      ref={formRef}
      // The confirmation checkbox's native input is hidden, so a browser validation bubble would point at nothing.
      // The form checks itself and names what is missing above the buttons.
      noValidate
      className="border-line mt-5 space-y-4 border-t pt-5"
      aria-label={`Publish ${finding.title}`}
      onChange={(event) => {
        setDirty(true);
        setSaved(false);
        if (
          event.target instanceof Element &&
          event.target.getAttribute("name") !== "reusable"
        ) {
          setConfirmedReusable(false);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!confirmedReusable) {
          setError("Tick “I reviewed this wording” to approve.");
          return;
        }
        const values = readDraft(event.currentTarget);
        const parsed = PublishLearningInput.safeParse({
          ...(values.success ? values.data : {}),
          reviewId: review.id,
          expectedRevision: editor.revision,
          confirmReusable:
            confirmedReusable &&
            new FormData(event.currentTarget).get("reusable") === "on",
        });
        if (!parsed.success) {
          setError(
            "Check the wording, scope and your confirmation before publishing.",
          );
          return;
        }
        publish.execute(parsed.data);
      }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <h4 className="text-[17px] font-semibold">
          What future customers can learn
        </h4>
        <p className="text-ink-2 text-[14px]">
          Edit the public fact below. Leave out names, order details and this
          customer’s special arrangements.
        </p>
        <Textarea
          label="Public wording"
          id={`${id}-body`}
          name="body"
          defaultValue={draft?.body ?? finding.proposedFact ?? ""}
          required
          minLength={10}
          maxLength={2000}
          rows={4}
        />
        <ChoiceSelect
          id={`${id}-product`}
          label="Applies to"
          name="product"
          defaultValue={draft?.productId ?? ""}
          required={finding.kind === "product_rule"}
          placeholder="Choose a product"
          options={[
            ...(finding.kind === "product_rule"
              ? []
              : [{ value: "", label: "The whole shop" }]),
            ...products.map((product) => ({
              value: product.id,
              label: product.title,
            })),
          ]}
        />
        <details
          open={finding.kind === "temporary_information"}
          className="text-[14px]"
        >
          <summary className="text-brand min-h-11 cursor-pointer py-3 font-semibold">
            Title, topic and expiry
          </summary>
          <div className="space-y-4 pb-3">
            <Input
              label="Title"
              id={`${id}-title`}
              name="title"
              defaultValue={draft?.title ?? finding.title}
              required
              minLength={3}
              maxLength={100}
            />
            <ChoiceSelect
              id={`${id}-topic`}
              label="Topic"
              name="topic"
              defaultValue={draft?.topic ?? "general"}
              options={GUIDE_TOPICS.map((topic) => ({
                value: topic,
                label: GUIDE_LABELS[topic],
              }))}
            />
            <Input
              label={
                finding.kind === "temporary_information"
                  ? "Expires at (required)"
                  : "Expires at (optional)"
              }
              description="Your device’s local time. Leave blank for an ongoing fact."
              id={`${id}-expiry`}
              name="expiry"
              type="datetime-local"
              defaultValue={localDate(draft?.validUntil)}
              required={finding.kind === "temporary_information"}
            />
          </div>
        </details>
        {finding.questions.length ? (
          <Textarea
            label="Your answers to the open questions"
            description="Private review note. Include any details customers need in the public wording above."
            id={`${id}-clarification`}
            name="clarification"
            defaultValue={draft?.clarification ?? ""}
            required
            minLength={5}
            maxLength={1000}
            rows={2}
          />
        ) : null}
        {finding.conflictingGuideIds.map((guideId) => {
          const guide = review.source.guides.find(
            (item) => item.id === guideId,
          );
          return (
            <fieldset
              key={guideId}
              className="border-line space-y-3 border-t pt-4"
            >
              <legend className="text-[14px] font-semibold">
                Resolve: {guide?.title}
              </legend>
              <p className="text-ink-2 text-[14px]">{guide?.body}</p>
              <ChoiceSelect
                id={`${id}-${guideId}`}
                label="Which rule should apply?"
                name={`decision-${guideId}`}
                required
                placeholder="Choose…"
                defaultValue={
                  draft?.conflicts.find((c) => c.guideId === guideId)
                    ?.resolution ?? ""
                }
                options={[
                  {
                    value: "replace",
                    label: "Replace this rule with the wording above",
                  },
                  { value: "keep", label: "Keep both; they apply differently" },
                ]}
              />
              <Textarea
                label="Explain your decision"
                description="Private note. Make any different conditions clear in the public wording."
                id={`${id}-${guideId}-reason`}
                name={`reason-${guideId}`}
                defaultValue={
                  draft?.conflicts.find((c) => c.guideId === guideId)?.reason ??
                  ""
                }
                required
                minLength={5}
                maxLength={500}
                rows={2}
              />
            </fieldset>
          );
        })}
        <Checkbox
          name="reusable"
          checked={confirmedReusable}
          onCheckedChange={(checked) => setConfirmedReusable(checked === true)}
          required
          label="I reviewed this wording. It is safe to share with every customer in the selected scope."
        />
      </fieldset>
      <p role="status" className="text-ink-2 text-[13px]">
        {dirty
          ? "Unsaved edits. Save your draft before leaving or switching answers."
          : saved || draft
            ? "Draft saved privately. Customers cannot use it until you approve."
            : "You can save unfinished wording and return to it later."}
      </p>
      {error ||
      publish.result.serverError ||
      save.result.serverError ||
      publish.result.validationErrors ||
      save.result.validationErrors ? (
        <Alert
          tone="danger"
          title={
            error ??
            publish.result.serverError ??
            save.result.serverError ??
            "Check the form and try again."
          }
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} loading={publish.isPending}>
          Approve for future customers
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          loading={save.isPending}
          onClick={() => {
            if (!formRef.current) return;
            setError(null);
            const values = readDraft(formRef.current);
            const parsed = SaveLearningDraftInput.safeParse({
              reviewId: review.id,
              expectedRevision: editor.revision,
              draft: values.success ? values.data : null,
            });
            if (!parsed.success) {
              setError("Check the field lengths and expiry before saving.");
              return;
            }
            pendingDraft.current = parsed.data.draft;
            save.execute(parsed.data);
          }}
        >
          Save draft
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setEditor(null);
            setDirty(false);
            setSaved(false);
          }}
        >
          {dirty ? "Discard unsaved edits" : "Close"}
        </Button>
      </div>
    </form>
  );
}

function localDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
