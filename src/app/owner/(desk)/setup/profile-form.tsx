"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import {
  SHOP_THEME_IDS,
  SHOP_THEMES,
  type ShopThemeId,
} from "@/lib/shop-themes";
import { updateProfileAction } from "./actions";

/** Editable shop details and the current configuration limits. */
export type ProfileValues = {
  policyRevision: number;
  displayName: string;
  contactEmail: string;
  country: string;
  currency: string;
  pickupPolicy: string | null;
  serviceRequestPolicy: string | null;
  digitalAccessPolicy: string | null;
  cancellationPolicy: string | null;
  taxPolicy: string | null;
  allowedOrigins: string[];
  buyerTurnsPer10Min: number;
  sellerDailyAiTurns: number;
  theme: string;
};

const TERMS: {
  key:
    | "pickupPolicy"
    | "serviceRequestPolicy"
    | "digitalAccessPolicy"
    | "cancellationPolicy"
    | "taxPolicy";
  label: string;
  hint: string;
}[] = [
  {
    key: "taxPolicy",
    label: "Tax statement",
    hint: "Required. For example “Prices include all applicable sales tax.”",
  },
  {
    key: "pickupPolicy",
    label: "Pickup",
    hint: "Needed for pickup items: where, when, how long you hold an order.",
  },
  {
    key: "serviceRequestPolicy",
    label: "Service requests",
    hint: "Needed for services: how and when you confirm a time after payment.",
  },
  {
    key: "digitalAccessPolicy",
    label: "Download access",
    hint: "Needed for downloads: how long links work, how buyers get help.",
  },
  {
    key: "cancellationPolicy",
    label: "Cancellation",
    hint: "What buyers can expect if they change their mind.",
  },
];

/** Shop identity, buyer-facing terms, widget origins and AI limits. Changing a term issues a new terms version. */
export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [origins, setOrigins] = useState(initial.allowedOrigins.join("\n"));
  const [message, setMessage] = useState<string | null>(null);
  const save = useAction(updateProfileAction, {
    onSuccess: ({ data }) => {
      setMessage(
        data?.termsChanged
          ? "Saved. Your terms changed, so open quotes must be refreshed before buyers pay."
          : "Saved.",
      );
      if (data)
        setValues((current) => ({
          ...current,
          policyRevision: data.policyRevision,
        }));
      router.refresh();
    },
  });
  const set = <K extends keyof ProfileValues>(
    key: K,
    value: ProfileValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    save.execute({
      expectedPolicyRevision: values.policyRevision,
      displayName: values.displayName,
      contactEmail: values.contactEmail,
      country: values.country.toUpperCase(),
      pickupPolicy: values.pickupPolicy ?? "",
      serviceRequestPolicy: values.serviceRequestPolicy ?? "",
      digitalAccessPolicy: values.digitalAccessPolicy ?? "",
      cancellationPolicy: values.cancellationPolicy ?? "",
      taxPolicy: values.taxPolicy ?? "",
      allowedOrigins: origins
        .split(/\s+/)
        .map((o) => o.trim())
        .filter(Boolean),
      buyerTurnsPer10Min: values.buyerTurnsPer10Min,
      sellerDailyAiTurns: values.sellerDailyAiTurns,
      theme: (SHOP_THEME_IDS as readonly string[]).includes(values.theme)
        ? (values.theme as ShopThemeId)
        : undefined,
    });
  };
  const fieldErrors = save.result.validationErrors as
    | Record<string, { _errors?: string[] }>
    | undefined;
  const firstFieldError = fieldErrors
    ? Object.values(fieldErrors).flatMap((entry) => entry?._errors ?? [])[0]
    : undefined;
  const error = save.result.serverError ?? firstFieldError ?? null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <section
        className="surface flex flex-col gap-4 p-5 scroll-mt-40 sm:scroll-mt-28"
        id="shop"
        aria-labelledby="shop-heading"
      >
        <h2 id="shop-heading" className="text-[17px] font-semibold">
          Shop
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Shop name"
            id="displayName"
            value={values.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            maxLength={80}
          />
          <Input
            label="Contact email for buyers"
            id="contactEmail"
            type="email"
            value={values.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
          <Input
            label="Country"
            description="Two letters, for example CA or US."
            id="country"
            value={values.country}
            onChange={(e) => set("country", e.target.value)}
            maxLength={2}
          />
          <Input
            label="Currency"
            description="Set when the shop was created."
            id="currency"
            value={values.currency}
            disabled
          />
        </div>
        <fieldset
          id="shop-colours"
          aria-describedby="theme-hint"
          className="flex flex-col gap-3 scroll-mt-40 sm:scroll-mt-28"
        >
          <legend className="text-[14px] font-medium">
            Customer shop colours
          </legend>
          <p id="theme-hint" className="text-ink-3 -mt-1 text-[13px]">
            Changes your customer page&apos;s header and buttons when you save.
            Your desk keeps its own theme.
          </p>
          <RadioCards
            aria-label="Choose customer colours"
            minColumnWidth={130}
            disabled={save.isPending}
            name="theme"
            value={values.theme}
            options={SHOP_THEME_IDS.map((id) => ({
              value: id,
              label: SHOP_THEMES[id].label,
              description: SHOP_THEMES[id].description,
              meta: (
                <span aria-hidden="true" className="flex gap-1.5">
                  {SHOP_THEMES[id].swatch.map((colour, index) => (
                    <span
                      key={index}
                      className="size-6 rounded-md"
                      style={{ backgroundColor: colour }}
                    />
                  ))}
                </span>
              ),
            }))}
            onValueChange={(value) => set("theme", value as ShopThemeId)}
          />
          <a
            href="/buy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink w-fit text-[14px] font-medium underline underline-offset-4"
          >
            Preview saved shop colours ↗
          </a>
        </fieldset>
      </section>
      <section
        className="surface flex flex-col gap-4 p-5 scroll-mt-40 sm:scroll-mt-28"
        id="terms"
        aria-labelledby="terms-heading"
      >
        <div>
          <h2 id="terms-heading" className="text-[17px] font-semibold">
            Terms buyers agree to
          </h2>
          <p className="text-ink-2 text-[14px]">
            Shown on every quote and copied into each order. The assistant can
            only repeat these words; it cannot promise anything else.
          </p>
        </div>
        {TERMS.map((term) => (
          <Textarea
            key={term.key}
            label={term.label}
            description={term.hint}
            id={term.key}
            rows={2}
            value={values[term.key] ?? ""}
            onChange={(e) => set(term.key, e.target.value)}
            maxLength={1000}
          />
        ))}
      </section>
      <section
        className="surface flex flex-col gap-4 p-5 scroll-mt-40 sm:scroll-mt-28"
        aria-labelledby="widget-heading"
        id="widget"
      >
        <h2 id="widget-heading" className="text-[17px] font-semibold">
          Where your assistant appears
        </h2>
        <Textarea
          label="Allowed websites"
          description="One main website address per line, such as https://shop.example.com. Add up to 10. HTTP is only for local testing."
          id="origins"
          aria-describedby="origins-hint"
          rows={3}
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          className="font-mono text-[14px]"
        />
        <details
          id="usage-limits"
          open
          className="scroll-mt-40 sm:scroll-mt-28"
        >
          <summary className="text-ink-2 cursor-pointer py-2 text-[14px] font-medium">
            AI usage limits
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Input
              label="Buyer messages per 10 minutes"
              description="Per chat. Keeps AI cost bounded."
              id="buyerTurns"
              type="number"
              min={1}
              max={100}
              value={values.buyerTurnsPer10Min}
              onChange={(e) =>
                set("buyerTurnsPer10Min", Number(e.target.value))
              }
            />
            <Input
              label="AI replies per day, whole shop"
              description="Buyer chat and your assistant together."
              id="sellerTurns"
              type="number"
              min={1}
              max={100000}
              value={values.sellerDailyAiTurns}
              onChange={(e) =>
                set("sellerDailyAiTurns", Number(e.target.value))
              }
            />
          </div>
        </details>
      </section>
      {error ? <Alert tone="danger" title={error} /> : null}
      {message ? <Alert tone="success" title={message} /> : null}
      <Button type="submit" className="self-start" loading={save.isPending}>
        Save shop details
      </Button>
    </form>
  );
}
