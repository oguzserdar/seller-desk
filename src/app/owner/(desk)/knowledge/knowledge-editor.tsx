"use client";
import { ChoiceSelect } from "@/components/choice-select";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { ArrowUpRight, Plus } from "lucide-react";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Button } from "@/components/arc/button/button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import {
  GUIDE_LABELS,
  GUIDE_LIMIT,
  GUIDE_TOPICS,
  GuideInput,
} from "@/lib/shop-guide";
import { KnowledgeHistory } from "./knowledge-history";
import { removeGuideAction, saveGuideAction } from "./actions";

const EMPTY: GuideInput = {
  title: "",
  body: "",
  topic: "general",
  published: false,
  actionLabel: "",
  actionUrl: "",
  productId: null,
  validUntil: null,
};

function EntryForm({
  initial,
  products,
  onClose,
  onSaved,
}: {
  initial: GuideInput;
  products: { id: string; title: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const saved = () => {
    router.refresh();
    onSaved();
  };
  const save = useAction(saveGuideAction, { onSuccess: saved });
  const remove = useAction(removeGuideAction, { onSuccess: saved });
  const update = <K extends keyof GuideInput>(key: K, next: GuideInput[K]) =>
    setValue((previous) => ({ ...previous, [key]: next }));
  const error =
    localError ??
    save.result.serverError ??
    remove.result.serverError ??
    (save.result.validationErrors ? "Check the fields and try again." : null);
  return (
    <form
      className="border-line mt-5 border-t pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        const checked = GuideInput.safeParse(value);
        if (!checked.success) {
          setLocalError(
            checked.error.issues[0]?.message ?? "Check the fields.",
          );
          return;
        }
        setLocalError(null);
        save.execute(checked.data);
      }}
    >
      <h2 className="text-[22px] font-semibold">
        {initial.id ? "Edit shop knowledge" : "Add shop knowledge"}
      </h2>
      <p className="text-ink-2 mt-1 text-[14px]">
        Everything you publish here can be shown to customers. Keep customer
        details, passwords and private links out.
      </p>
      <fieldset
        disabled={save.isPending || remove.isPending}
        className="mt-5 flex flex-col gap-5"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_210px]">
          <Input
            label="Title"
            autoFocus
            id="guide-title"
            value={value.title}
            onChange={(e) => update("title", e.target.value)}
            maxLength={100}
            required
            placeholder="For example: Choosing the right size"
          />
          <ChoiceSelect
            id="guide-topic"
            label="Topic"
            value={value.topic}
            onValueChange={(next) =>
              update("topic", next as GuideInput["topic"])
            }
            options={GUIDE_TOPICS.map((topic) => ({
              value: topic,
              label: GUIDE_LABELS[topic],
            }))}
          />
        </div>
        <Textarea
          label="Facts the assistant can use"
          description="Be specific about who this applies to, conditions and exceptions. Publishing this does not change your checkout terms."
          id="guide-body"
          aria-describedby="guide-body-hint"
          rows={7}
          maxLength={2000}
          required
          value={value.body}
          onChange={(e) => update("body", e.target.value)}
          placeholder="Paste your existing policy, or write a short explanation in your own words."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceSelect
            id="guide-product"
            label="Applies to"
            hint="Product rules are used only when answering about that product."
            value={value.productId ?? ""}
            onValueChange={(next) => update("productId", next || null)}
            options={[
              { value: "", label: "The whole shop" },
              ...products.map((product) => ({
                value: product.id,
                label: product.title,
              })),
            ]}
          />
          <Input
            label="Expires at (optional)"
            description={`Your time: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Expired facts and their links stop being used.`}
            id="guide-expiry"
            type="datetime-local"
            value={
              value.validUntil
                ? new Date(
                    new Date(value.validUntil).getTime() -
                      new Date(value.validUntil).getTimezoneOffset() * 60_000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
            onChange={(e) =>
              update(
                "validUntil",
                e.target.value ? new Date(e.target.value).toISOString() : null,
              )
            }
          />
        </div>
        <div className="bg-sunken rounded-[12px] p-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <ArrowUpRight size={17} aria-hidden />
            Continue on your existing site
          </p>
          <p className="text-ink-2 mt-1 text-[14px]">
            Optional. Link to product options, a booking page, customer portal
            or returns form. The assistant can offer the link; it cannot
            complete the action there.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-[210px_1fr]">
            <Input
              label="Button label"
              id="guide-label"
              maxLength={60}
              value={value.actionLabel}
              onChange={(e) => update("actionLabel", e.target.value)}
              placeholder="Choose a time"
            />
            <Input
              label="Public HTTPS address"
              id="guide-url"
              type="url"
              maxLength={1500}
              value={value.actionUrl}
              onChange={(e) => update("actionUrl", e.target.value)}
              placeholder="https://your-shop.com/book"
            />
          </div>
        </div>
        <Checkbox
          checked={value.published}
          onCheckedChange={(checked) => update("published", checked === true)}
          label="Approved for customer answers"
          description="Leave unchecked to keep a draft. Changes take effect on the next knowledge check."
        />
        {error ? <Alert tone="danger" title={error} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={save.isPending}>
            {value.published ? "Save & publish" : "Save draft"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {value.id && value.expectedRevision ? (
            <Button
              type="button"
              variant="danger"
              className="sm:ml-auto"
              onClick={() => setConfirmRemove(true)}
            >
              Remove entry
            </Button>
          ) : null}
        </div>
        {confirmRemove ? (
          <Alert tone="warning" title="Remove this entry?">
            The assistant will stop using it and its old links will stop
            working.
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.execute({
                    id: value.id!,
                    expectedRevision: value.expectedRevision!,
                  })
                }
              >
                Remove now
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmRemove(false)}
              >
                Keep entry
              </Button>
            </div>
          </Alert>
        ) : null}
      </fieldset>
    </form>
  );
}

/** Own editor for a bounded, reviewable set of public shop facts and destinations. */
export function KnowledgeEditor({
  entries,
  removedEntries,
  products,
  expiredIds,
}: {
  expiredIds: string[];
  entries: GuideInput[];
  removedEntries: GuideInput[];
  products: { id: string; title: string }[];
}) {
  const [historyEntry, setHistoryEntry] = useState<GuideInput | null>(null);
  const [editing, setEditing] = useState<GuideInput | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-2 text-[14px]">
          {
            entries.filter(
              (entry) =>
                entry.published && !expiredIds.includes(entry.id ?? ""),
            ).length
          }{" "}
          published · {entries.length} of {GUIDE_LIMIT} entries
        </p>
        {!editing ? (
          <Button
            type="button"
            variant="secondary"
            disabled={entries.length >= GUIDE_LIMIT}
            onClick={() => {
              setEditing({ ...EMPTY });
              setNotice(null);
            }}
          >
            <Plus size={17} aria-hidden />
            Add knowledge
          </Button>
        ) : null}
      </div>
      {notice ? <Alert className="mt-4" tone="success" title={notice} /> : null}
      {editing ? (
        <EntryForm
          key={editing.id ?? "new"}
          initial={editing}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("Shop knowledge updated.");
          }}
        />
      ) : entries.length ? (
        <ul className="divide-line border-line mt-5 divide-y border-y">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-3 text-[13px]">
                    {GUIDE_LABELS[entry.topic]}
                  </span>
                  <Badge
                    tone={
                      entry.published && !expiredIds.includes(entry.id ?? "")
                        ? "success"
                        : "neutral"
                    }
                  >
                    {entry.published
                      ? expiredIds.includes(entry.id ?? "")
                        ? "Expired"
                        : "Published"
                      : "Draft"}
                  </Badge>
                </div>
                <p className="text-ink-3 mt-2 text-[13px]">
                  {entry.productId
                    ? (products.find(
                        (product) => product.id === entry.productId,
                      )?.title ?? "Selected product")
                    : "Whole shop"}
                  {entry.validUntil
                    ? ` · Expires ${entry.validUntil.replace("T", " ").replace(":00.000Z", " UTC")}`
                    : ""}
                </p>
                <h2 className="mt-2 text-[18px] font-semibold [overflow-wrap:anywhere]">
                  {entry.title}
                </h2>
                <p className="text-ink-2 mt-1 line-clamp-2 max-w-2xl text-[14px] [overflow-wrap:anywhere]">
                  {entry.body}
                </p>
                {entry.actionUrl ? (
                  <p className="text-ink-3 mt-2 text-[13px] [overflow-wrap:anywhere]">
                    {entry.actionLabel} · {new URL(entry.actionUrl).hostname}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setHistoryEntry(null);
                    setEditing(entry);
                  }}
                  aria-label={`Edit ${entry.title}`}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setHistoryEntry(entry)}
                  aria-label={`History of ${entry.title}`}
                >
                  History
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-line mt-5 border-y py-10">
          <h2 className="text-[20px] font-semibold">
            Start with a question customers ask every day.
          </h2>
          <p className="text-ink-2 mt-2 max-w-xl text-[15px] leading-relaxed">
            Shipping times. Which size to choose. How to reschedule. Add the
            answer you trust, then try asking it in your shop.
          </p>
        </div>
      )}
      {historyEntry ? (
        <KnowledgeHistory
          key={`${historyEntry.id}-${historyEntry.expectedRevision}`}
          entry={historyEntry}
          products={products}
          onClose={() => setHistoryEntry(null)}
          onRestored={() => {
            setHistoryEntry(null);
            setNotice(
              "Version restored as a draft. Review and publish it when ready.",
            );
          }}
        />
      ) : null}
      {removedEntries.length ? (
        <details className="border-line mt-6 border-t pt-3">
          <summary className="text-ink-2 min-h-11 cursor-pointer py-3 text-[14px] font-semibold">
            Removed entries ({removedEntries.length})
          </summary>
          <ul>
            {removedEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-[14px]">{entry.title}</span>
                <Button
                  variant="ghost"
                  onClick={() => setHistoryEntry(entry)}
                  aria-label={`History of removed ${entry.title}`}
                >
                  View history
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-ink-3 mt-6 max-w-2xl text-[13px] leading-relaxed">
        The assistant writes each reply using your approved facts. It cannot see
        inventory, availability or orders on another site. If the answer needs
        you, it asks you.
      </p>
    </div>
  );
}
