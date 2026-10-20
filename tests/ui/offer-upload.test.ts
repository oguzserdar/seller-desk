// @vitest-environment happy-dom
/** @fileoverview A digital offer cannot start an empty upload and identifies the selected file. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ execute: vi.fn(), isPending: false, result: {} }),
}));
vi.mock("../../src/app/owner/(desk)/offers/actions", () => ({
  saveOfferAction: vi.fn(),
  uploadAssetAction: vi.fn(),
}));
import { OfferForm } from "../../src/app/owner/(desk)/offers/offer-form";
it("refuses an empty upload and shows the chosen file before submitting it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(OfferForm, {
          currency: "USD",
          initial: {
            kind: "digital",
            title: "",
            description: "",
            unitAmountMinor: null,
            fulfillmentNote: "",
            requiresScopeReview: false,
            serviceScope: "",
            accessDays: 30,
            digitalAssetId: null,
            assetName: null,
            maxQuantity: 1,
            stockTotal: null,
          },
        }),
      ),
    );
    const button = () =>
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Upload file",
      )!;
    expect(button().disabled).toBe(true);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [
        new File(["%PDF-test"], "guide.pdf", { type: "application/pdf" }),
      ],
      configurable: true,
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(host.textContent).toContain("guide.pdf");
    expect(button().disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
