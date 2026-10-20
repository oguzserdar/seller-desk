"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import {
  RichTextEditor,
  markdownToHtml,
} from "@/components/arc/rich-text-editor/rich-text-editor";
import {
  ProcedureContent,
  type ProcedureEditorValue,
} from "@/lib/assistant-procedure";
import {
  instructionHistoryAction,
  pauseInstructionAction,
  publishInstructionAction,
  restoreInstructionAction,
  saveInstructionAction,
} from "./actions";
import type { ProcedurePreviewView } from "@/lib/procedure-preview";
import { InstructionPreview } from "./instruction-preview";

const EMPTY: ProcedureContent = { title: "", whenToUse: "", steps: "" };

/** Separates private saving from exact-version publication; local edits revoke approval. */
export function InstructionEditor({
  initial,
  onClose,
  previews = [],
  modelConnected = false,
}: {
  initial: ProcedureEditorValue | null;
  onClose: () => void;
  previews?: ProcedurePreviewView[];
  modelConnected?: boolean;
}) {
  const router = useRouter();
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [saved, setSaved] = useState(initial),
    [content, setContent] = useState(initial?.content ?? EMPTY);
  const [stepsHtml, setStepsHtml] = useState(() =>
    markdownToHtml(initial?.content.steps ?? ""),
  );
  const [approved, setApproved] = useState(false),
    [showHistory, setShowHistory] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null),
    [localError, setLocalError] = useState<string | null>(null);
  const dirty =
    JSON.stringify(content) !== JSON.stringify(saved?.content ?? EMPTY);
  const accepted = (
    row: ProcedureEditorValue | undefined,
    message: string,
    preserveEdits = false,
  ) => {
    if (!row) return;
    setSaved(row);
    if (!preserveEdits || !dirty) {
      setContent(row.content);
      setStepsHtml(markdownToHtml(row.content.steps));
    }
    setApproved(false);
    setConfirmArchive(false);
    setConfirmClose(false);
    setLocalError(null);
    setNotice(message);
    setShowHistory(false);
    router.refresh();
    if (row.archived) onClose();
  };
  const save = useAction(saveInstructionAction, {
    onSuccess: ({ data }) =>
      accepted(
        data,
        "Draft saved privately. Customer conversations keep the currently published version.",
      ),
  });
  const publish = useAction(publishInstructionAction, {
    onSuccess: ({ data }) =>
      accepted(
        data,
        "Published. Your assistant will read this version on its next step.",
      ),
  });
  const pause = useAction(pauseInstructionAction, {
    onSuccess: ({ data }) =>
      accepted(
        data,
        "Paused. Your assistant will stop using this instruction on its next step.",
        true,
      ),
  });
  const restore = useAction(restoreInstructionAction, {
    onSuccess: ({ data }) =>
      accepted(
        data,
        "Restored as a new draft. The published version has not changed.",
      ),
  });
  const history = useAction(instructionHistoryAction);
  const busy =
    save.isPending || publish.isPending || pause.isPending || restore.isPending;
  const error =
    localError ??
    save.result.serverError ??
    publish.result.serverError ??
    pause.result.serverError ??
    restore.result.serverError ??
    history.result.serverError ??
    ([save.result, publish.result, pause.result, restore.result].some(
      (result) => result.validationErrors,
    )
      ? "Check your fields and reload the saved version if it changed."
      : null);
  const update = (key: keyof ProcedureContent, value: string) => {
    setContent((previous) => ({ ...previous, [key]: value }));
    setApproved(false);
    setNotice(null);
    setConfirmArchive(false);
  };
  return (
    <section className="mt-8" aria-label="Instruction editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold">
          {saved ? "Edit instruction" : "New instruction"}
        </h2>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => (dirty ? setConfirmClose(true) : onClose())}
        >
          All instructions
        </Button>
      </div>
      <p className="text-ink-2 mt-2 text-[14px]">
        {saved?.publishedRevision
          ? `Customers use version ${saved.publishedRevision}. ${saved.revision === saved.publishedRevision ? "Edits here stay private until saved and published." : `Version ${saved.revision} is a private draft.`}`
          : "Not in use. Saving a draft does not publish it."}
      </p>
      <form
        className="mt-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const parsed = ProcedureContent.safeParse(content);
          if (!parsed.success) {
            setLocalError(
              "Add a name, when to use it, and an instruction between 20 and 2,000 characters.",
            );
            return;
          }
          setLocalError(null);
          save.execute({
            id,
            expectedRevision: saved?.revision ?? 0,
            content: parsed.data,
          });
        }}
      >
        <fieldset disabled={busy} className="flex flex-col gap-5">
          <Input
            label="Name"
            autoFocus
            id="instruction-name"
            name="title"
            value={content.title}
            onChange={(event) => update("title", event.target.value)}
            minLength={3}
            maxLength={100}
            required
            placeholder="For example: Urgent repairs"
          />
          <Input
            label="When to use it"
            id="instruction-when"
            name="whenToUse"
            value={content.whenToUse}
            onChange={(event) => update("whenToUse", event.target.value)}
            minLength={5}
            maxLength={300}
            required
            placeholder="A customer needs a repair by a particular date."
          />
          <section
            aria-labelledby="instruction-steps-label"
            aria-describedby="instruction-steps-hint"
            className="flex flex-col gap-3"
          >
            <h3 id="instruction-steps-label" className="text-sm font-medium">
              What should the assistant do?
            </h3>
            <div className="surface p-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-foreground">
              <RichTextEditor
                value={stepsHtml}
                readOnly={busy}
                aria-label="What should the assistant do?"
                placeholder="Ask what needs repairing and keep the customer's deadline. Ask me to confirm availability before promising a time."
                onChange={({ html, markdown }) => {
                  setStepsHtml(html);
                  update("steps", markdown);
                }}
              />
            </div>
            <div className="flex flex-wrap items-start justify-between gap-2 text-xs text-ink-3">
              <p id="instruction-steps-hint">
                Select text to format. Type / for a heading or list. Keep
                one-customer exceptions in their conversation.
              </p>
              <span className="tabular">
                {content.steps.length.toLocaleString("en-US")} / 2,000
              </span>
            </div>
          </section>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!dirty && saved !== null}
              loading={save.isPending}
            >
              Save draft
            </Button>
            {dirty ? (
              <span className="text-ink-3 text-[13px]">Unsaved changes</span>
            ) : saved ? (
              <span className="text-ink-3 text-[13px]">
                Saved version {saved.revision}
              </span>
            ) : null}
          </div>
        </fieldset>
      </form>
      {notice ? <Alert className="mt-5" title={notice} /> : null}
      {error ? <Alert className="mt-5" tone="danger" title={error} /> : null}
      {saved ? (
        <InstructionPreview
          saved={saved}
          dirty={dirty}
          busy={busy}
          modelConnected={modelConnected}
          reports={previews.filter((report) => report.procedureId === saved.id)}
        />
      ) : null}
      {saved ? (
        <div className="border-line mt-7 border-t pt-5">
          {saved.publishedRevision !== saved.revision ? (
            <>
              <Checkbox
                name="approveInstruction"
                disabled={dirty || busy}
                checked={approved}
                onCheckedChange={(checked) => setApproved(checked === true)}
                label="Use this saved wording in customer conversations."
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  disabled={dirty || !approved || busy}
                  loading={publish.isPending}
                  onClick={() =>
                    publish.execute({
                      id,
                      expectedRevision: saved.revision,
                      approve: true,
                    })
                  }
                >
                  Publish saved version
                </Button>
                {dirty ? (
                  <p className="text-ink-3 text-[13px]">
                    Save your changes before reviewing publication.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-ink-2 text-[14px]">
              This saved version is in use.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {saved.publishedRevision !== null ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  pause.execute({
                    id,
                    expectedRevision: saved.revision,
                    archive: false,
                  })
                }
              >
                Pause instruction
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy || history.isPending}
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) history.execute({ id });
              }}
            >
              {showHistory ? "Hide history" : "Version history"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || dirty}
              onClick={() => setConfirmArchive(true)}
            >
              Archive
            </Button>
          </div>
        </div>
      ) : null}
      {confirmClose ? (
        <Alert
          className="mt-5"
          tone="warning"
          title="Your latest edits are not saved."
        >
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onClose}>
              Discard edits and close
            </Button>
            <Button variant="ghost" onClick={() => setConfirmClose(false)}>
              Keep editing
            </Button>
          </div>
        </Alert>
      ) : null}
      {confirmArchive && saved ? (
        <Alert
          className="mt-5"
          tone="warning"
          title="Archive this instruction?"
        >
          The assistant will stop using it. Saved versions remain available.
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={pause.isPending}
              onClick={() =>
                pause.execute({
                  id,
                  expectedRevision: saved.revision,
                  archive: true,
                })
              }
            >
              Archive instruction
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmArchive(false)}
            >
              Keep instruction
            </Button>
          </div>
        </Alert>
      ) : null}
      {showHistory && saved ? (
        <section
          aria-label="Saved instruction versions"
          className="border-line mt-7 border-t pt-5"
        >
          <h3 className="text-[18px] font-semibold">Saved versions</h3>
          <p className="text-ink-2 mt-2 text-[14px]">
            Restoring creates a new draft. Customers keep the published version
            until you approve a replacement.
          </p>
          {history.isPending ? (
            <p role="status" className="mt-3 text-[14px]">
              Loading versions…
            </p>
          ) : null}
          <ol className="divide-line mt-4 divide-y">
            {history.result.data?.versions.map((version) => (
              <li key={version.revision} className="py-5">
                <h4 className="text-[15px] font-semibold">
                  Version {version.revision}
                  {saved.publishedRevision === version.revision
                    ? " · In use"
                    : ""}
                  {saved.revision === version.revision
                    ? " · Current saved wording"
                    : ""}
                </h4>
                <p className="mt-2 text-[15px] font-semibold [overflow-wrap:anywhere]">
                  {version.content.title}
                </p>
                <p className="text-ink-2 mt-1 text-[14px] [overflow-wrap:anywhere]">
                  {version.content.whenToUse}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">
                  {version.content.steps}
                </p>
                {saved.revision !== version.revision ? (
                  <Button
                    variant="secondary"
                    className="mt-3"
                    disabled={dirty || busy}
                    onClick={() =>
                      restore.execute({
                        id,
                        expectedRevision: saved.revision,
                        restoreRevision: version.revision,
                      })
                    }
                  >
                    Restore version {version.revision} as draft
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          {dirty ? (
            <p className="text-ink-3 mt-3 text-[13px]">
              Save your current edits before restoring another version.
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
