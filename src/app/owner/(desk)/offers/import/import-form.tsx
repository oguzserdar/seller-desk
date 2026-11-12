"use client";

import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/arc/button/button";
import { cx } from "@/lib/cx";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatMoney } from "@/lib/money";
import { importOffersAction, previewImportAction } from "../actions";

const EXAMPLE =
  "Bike bell, 18, 12\nRear cargo rack, 140, 2\nWheel truing, 45, , service\nFrame size chart, 5, , download";
const KIND_WORD = {
  goods: "Pickup item",
  service: "Service",
  digital: "Download",
} as const;

/** Reviews a saved catalog import before adding unpublished offers. */
export function ImportForm() {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const preview = useAction(previewImportAction);
  const commit = useAction(importOffersAction);
  const reviewed =
    preview.input?.text === text ? preview.result.data : undefined;
  const rows = reviewed?.rows ?? [];
  const currency = reviewed?.currency ?? "USD";
  const ready = rows.filter((row) => !row.problem).length;
  const done = commit.result.data;
  const busy = preview.isPending || commit.isPending || loadingFile;

  function changeText(value: string) {
    setText(value);
    preview.reset();
    commit.reset();
    setFileError(null);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    changeText("");
    if (file.size > 80_000) {
      setFileError("Choose a smaller file, up to 80 KB and 20,000 characters.");
      return;
    }
    setLoadingFile(true);
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (content.length > 20_000) throw new Error("too large");
      setText(content);
    } catch {
      setFileError(
        "Use a UTF-8 CSV or TSV file with no more than 20,000 characters.",
      );
    } finally {
      setLoadingFile(false);
    }
  }

  if (done) {
    return (
      <div className="mt-8 flex flex-col gap-4">
        <Alert
          tone="success"
          title={`${done.created} ${done.created === 1 ? "draft" : "drafts"} added`}
        >
          {done.skipped > 0
            ? `${done.skipped} ${done.skipped === 1 ? "row was" : "rows were"} skipped. `
            : ""}
          Nothing is live yet. Check each price, stock count and fulfillment
          details in Offers before publishing.
        </Alert>
        <Link
          href="/owner/offers"
          className="text-brand text-[15px] font-semibold hover:underline"
        >
          Go to Offers
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Input
          label="Choose a catalog file"
          description="CSV or TSV, up to 50 product rows and 20,000 characters. Simple Shopify and WooCommerce exports are supported."
          id="import-file"
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          disabled={busy}
          onChange={(event) => void loadFile(event.target.files?.[0])}
        />
        {fileError ? <Alert tone="danger" title={fileError} /> : null}
      </div>
      <div className="flex flex-col gap-2">
        <Textarea
          label="Or paste your list"
          description="Name, price, stock, type. Stock is for pickup items; type is “service” or “download” when it is not a pickup item."
          id="import-text"
          rows={7}
          value={text}
          disabled={busy}
          maxLength={20_000}
          onChange={(event) => changeText(event.target.value)}
          placeholder={EXAMPLE}
          className="font-mono text-[14px]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => preview.execute({ text })}
          loading={preview.isPending}
          disabled={!text.trim() || busy}
        >
          Preview
        </Button>
        {text.trim() === "" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => changeText(EXAMPLE)}
          >
            Use the example
          </Button>
        ) : null}
      </div>
      {preview.result.serverError ? (
        <Alert tone="danger" title={preview.result.serverError} />
      ) : null}
      {preview.result.validationErrors ? (
        <Alert
          tone="danger"
          title={"Keep your file under 20,000 characters."}
        />
      ) : null}
      {rows.length > 0 ? (
        <section aria-label="Preview" className="flex flex-col gap-4">
          <div>
            <h3 className="text-[18px] font-semibold">
              Review {ready} {ready === 1 ? "draft" : "drafts"}
            </h3>
            <p className="text-ink-2 mt-1 text-[14px]">
              {reviewed?.format}. Confirm that these prices are in {currency}.{" "}
              {rows.length - ready > 0
                ? `${rows.length - ready} ${rows.length - ready === 1 ? "row needs" : "rows need"} review and will be skipped.`
                : "Every row is ready to draft."}
            </p>
          </div>
          <ul className="bg-surface border-line divide-line divide-y rounded-[12px] border">
            {rows.map((row) => (
              <li
                key={row.line}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="text-[15px] font-medium">
                    {row.title || `Row ${row.line}`}
                  </span>
                  <span className="text-ink-3 ml-2 text-[13px]">
                    {KIND_WORD[row.kind]}
                    {row.kind === "goods"
                      ? row.stock === null
                        ? ", stock missing; draft starts at 0"
                        : `, ${row.stock} in stock`
                      : ""}
                  </span>
                </span>
                <span
                  className={cx(
                    "text-[14px]",
                    row.problem
                      ? "text-danger font-medium"
                      : "tabular font-semibold",
                  )}
                >
                  {row.problem ??
                    (row.unitAmountMinor
                      ? formatMoney(row.unitAmountMinor, currency)
                      : "")}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-ink-2 text-[14px]">
            This adds new drafts. It does not update your existing shop or keep
            stock in sync. Photos, files, shipping and tax rules are not
            imported.
          </p>
          {commit.result.serverError ? (
            <Alert tone="danger" title={commit.result.serverError} />
          ) : null}
          <Button
            className="self-start"
            onClick={() =>
              reviewed &&
              commit.execute({
                draftId: reviewed.draftId,
                reviewRevision: reviewed.reviewRevision,
              })
            }
            loading={commit.isPending}
            disabled={ready === 0 || busy}
          >
            Add {ready} {ready === 1 ? "draft" : "drafts"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
