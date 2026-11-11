import { expect, it } from "vitest";
import { suggestionsFor } from "@/components/buyer/shop-window";
import type { PublicOffer } from "@/server/domain/offers";

const offer = (title: string, kind: PublicOffer["kind"], unitAmountMinor: number | null, available: number | null = 3) =>
  ({ id: title, title, kind, unitAmountMinor, available, currency: "USD" }) as unknown as PublicOffer;

it("asks what a customer of this shop would ask, from its own catalog", () => {
  const offers = [
    offer("Restored leather saddle, one of a kind", "goods", 6500, 1),
    offer("Rechargeable front light", "goods", 9500),
    offer("Brake service", "service", 12000),
    offer("Custom repair or service", "service", null),
    offer("Home brake care guide", "digital", 2500),
  ];
  expect(suggestionsFor(offers)).toEqual([
    "Can you do a brake service this week?",
    "Anything under $75?",
    "Can you quote a job for me?",
  ]);
});

it("skips products that are sold out and falls back to a download", () => {
  const offers = [offer("Front light", "goods", 9500, 0), offer("Care guide", "digital", 2500)];
  expect(suggestionsFor(offers)).toEqual(["Something I can download today"]);
});
