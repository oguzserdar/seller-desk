"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import {
  FileUpload,
  type FileUploadItem,
} from "@/components/arc/file-upload/file-upload";
import { RadioGroup } from "@/components/arc/radio-group/radio-group";
import { formatMoney, parsePriceInput } from "@/lib/money";
import type { OfferKind } from "@/server/db/types";
import { saveOfferAction, uploadAssetAction } from "./actions";

/** Editable offer data; server-side rules still validate every save. */
export type OfferFormValues = {
  id?: string;
  revision?: number;
  kind: OfferKind;
  title: string;
  description: string;
  unitAmountMinor: number | null;
  fulfillmentNote: string;
  requiresScopeReview: boolean;
  serviceScope: string;
  accessDays: number | null;
  digitalAssetId: string | null;
  assetName: string | null;
  maxQuantity: number;
  stockTotal: number | null;
};

const KINDS: { value: OfferKind; label: string; hint: string }[] = [
  {
    value: "goods",
    label: "Pickup item",
    hint: "A physical item the buyer collects. Stock is held while they pay.",
  },
  {
    value: "service",
    label: "Service",
    hint: "A paid service request. You confirm the time with the buyer after payment.",
  },
  {
    value: "digital",
    label: "Download",
    hint: "A file (ZIP, PDF, PNG or JPEG, up to 1 MB) the buyer downloads after payment.",
  },
];

const NOTE_HINT: Record<OfferKind, string> = {
  goods:
    "Where and when buyers collect it, for example “Pickup at the shop, Tue–Sat 10–5.”",
  service:
    "What happens after payment, for example “We call within one business day to book a time.”",
  digital:
    "What the buyer gets, for example “Download link works for 30 days.”",
};

function minorToText(minor: number | null, currency: string): string {
  if (minor === null) return "";
  return formatMoney(minor, currency)
    .replace(/[^\d.,]/g, "")
    .replace(/,/g, "");
}

/** Edits offer data using the existing Arc form components. */
export function OfferForm({
  initial,
  currency,
}: {
  initial: OfferFormValues;
  currency: string;
}) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [kind, setKind] = useState<OfferKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [price, setPrice] = useState(
    minorToText(initial.unitAmountMinor, currency),
  );
  const [customPrice, setCustomPrice] = useState(
    initial.kind === "service" &&
      initial.unitAmountMinor === null &&
      Boolean(initial.id),
  );
  const quotedPerRequest = kind === "service" && customPrice;
  const [note, setNote] = useState(initial.fulfillmentNote);
  const [maxQuantity, setMaxQuantity] = useState(String(initial.maxQuantity));
  const [stock, setStock] = useState(
    initial.stockTotal === null ? "" : String(initial.stockTotal),
  );
  const [scope, setScope] = useState(initial.serviceScope);
  const [accessDays, setAccessDays] = useState(
    initial.accessDays === null ? "30" : String(initial.accessDays),
  );
  const [asset, setAsset] = useState<{
    id: string | null;
    name: string | null;
  }>({ id: initial.digitalAssetId, name: initial.assetName });
  const [uploading, startUpload] = useTransition();
  const [files, setFiles] = useState<FileUploadItem[]>([]);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useAction(saveOfferAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (!editing) {
        router.push(`/owner/offers/${data.id}?created=1`);
        return;
      }
      // The page remounts this form for the new revision, which would drop a local message,
      // so the confirmation travels in the address, as it does after creating an offer.
      router.replace(`/owner/offers/${data.id}?saved=${data.revision}`);
    },
  });

  const upload = () => {
    const file = files[0]?.error ? null : files[0]?.file;
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    setUploadMessage(null);
    setUploadFailed(false);
    startUpload(async () => {
      try {
        const result = await uploadAssetAction(form);
        if (result.ok) {
          setAsset({ id: result.id, name: result.filename });
          setFiles([]);
          setUploadMessage(
            `Uploaded ${result.filename} (${Math.ceil(result.sizeBytes / 1024)} KB). Save the offer to use it.`,
          );
        } else {
          setUploadFailed(true);
          setUploadMessage(result.message);
        }
      } catch {
        setUploadFailed(true);
        setUploadMessage("The file could not be uploaded. Try again.");
      }
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const unitAmountMinor = quotedPerRequest
      ? null
      : parsePriceInput(price, currency);
    if (
      !quotedPerRequest &&
      (unitAmountMinor === null || unitAmountMinor < 1)
    ) {
      setLocalError(`Enter a price in ${currency}, for example 35 or 35.00.`);
      return;
    }
    const max = Number.parseInt(maxQuantity, 10);
    const stockTotal = kind === "goods" ? Number.parseInt(stock, 10) : null;
    if (
      kind === "goods" &&
      (stockTotal === null || Number.isNaN(stockTotal) || stockTotal < 0)
    ) {
      setLocalError("Enter how many you have in stock (0 or more).");
      return;
    }
    save.execute({
      ...(initial.id
        ? { id: initial.id, expectedRevision: initial.revision }
        : {}),
      kind,
      title,
      description,
      unitAmountMinor,
      fulfillmentNote: note,
      requiresScopeReview:
        kind === "service" ? quotedPerRequest : false,
      serviceScope: kind === "service" ? scope : null,
      accessDays:
        kind === "digital" ? Number.parseInt(accessDays, 10) || null : null,
      digitalAssetId: kind === "digital" ? asset.id : null,
      maxQuantity: Number.isNaN(max) ? 1 : max,
      stockTotal,
    });
  };

  const error =
    localError ??
    save.result.serverError ??
    (save.result.validationErrors
      ? "Some fields need a look: check lengths and numbers."
      : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <section className="surface flex flex-col gap-4 p-5">
        {editing ? (
          <div>
            <p className="text-sm font-medium">
              Offer type: {KINDS.find((option) => option.value === kind)?.label}
            </p>
            <p className="text-ink-3 mt-1 text-sm">
              Create a new offer to use a different type.
            </p>
          </div>
        ) : (
          <RadioGroup
            label="Offer type"
            name="kind"
            value={kind}
            onValueChange={(value) => setKind(value as OfferKind)}
            options={KINDS.map(({ value, label, hint }) => ({
              value,
              label,
              description: hint,
            }))}
          />
        )}
        <Input
          label="Title"
          description="Up to 120 characters. Buyers see this first."
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
        <Textarea
          label="Description"
          description="What it is, size or scope, anything a buyer asks before paying."
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          required
        />
        {kind === "service" ? (
          <RadioGroup
            label="How do you price this service?"
            name="pricing"
            value={customPrice ? "quoted" : "fixed"}
            onValueChange={(value) => setCustomPrice(value === "quoted")}
            options={[
              { value: "fixed", label: "Fixed price" },
              {
                value: "quoted",
                label: "Quote each request",
                description:
                  "Customers describe the work. You send the price and scope; they decide whether to pay.",
              },
            ]}
          />
        ) : null}
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {!quotedPerRequest ? (
            <Input
              label={`Price (${currency})`}
              description="Include tax the way your tax statement in Setup says."
              id="price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="35.00"
              required
            />
          ) : null}
          <Input
            label="Quantity limit"
            description="Maximum per checkout."
            id="max"
            type="number"
            min={1}
            max={100}
            value={maxQuantity}
            onChange={(e) => setMaxQuantity(e.target.value)}
          />
        </div>
        {kind === "goods" ? (
          <Input
            label="In stock"
            description="Units for sale now, including any held in open checkouts."
            id="stock"
            type="number"
            min={0}
            max={100000}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        ) : null}
        {kind === "service" ? (
          <>
            <Textarea
              label="What the service includes"
              description="Buyers see this before paying, and the assistant matches their job to it. Work outside it is quoted separately. Do not promise a time here."
              id="scope"
              rows={3}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              maxLength={1000}
            />
          </>
        ) : null}
        {kind === "digital" ? (
          <div className="flex flex-col gap-4">
            <Input
              label="Download access (days)"
              id="days"
              type="number"
              min={1}
              max={3650}
              value={accessDays}
              onChange={(e) => setAccessDays(e.target.value)}
            />
            <div className="flex flex-col items-start gap-3">
              <div className="w-full">
                <FileUpload
                  label="File buyers receive"
                  description="ZIP, PDF, PNG or JPEG. Up to 1 MB. Upload before saving the offer."
                  accept=".zip,.pdf,.png,.jpg,.jpeg,application/zip,application/pdf,image/png,image/jpeg"
                  multiple={false}
                  maxSize={1048576}
                  value={files}
                  disabled={uploading}
                  onChange={(next) => {
                    setFiles(next);
                    setUploadMessage(null);
                  }}
                />
              </div>
              {asset.name ? (
                <p className="text-ink-2 text-[13px]">Uploaded: {asset.name}</p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={upload}
                loading={uploading}
                disabled={!files[0] || !!files[0].error}
              >
                Upload file
              </Button>
              {uploadMessage ? (
                <Alert
                  tone={uploadFailed ? "danger" : "success"}
                  title={uploadMessage}
                />
              ) : null}
            </div>
          </div>
        ) : null}
        <Input
          label="After payment"
          description={NOTE_HINT[kind]}
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </section>
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={save.isPending}>
          {editing ? "Save changes" : "Create offer"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/owner/offers")}
        >
          Back to offers
        </Button>
      </div>
    </form>
  );
}
