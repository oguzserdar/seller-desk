/** @fileoverview Configured shops should not be asked to retrieve credentials again. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../../src/app/owner/(desk)/setup/paypal-check-button", () => ({
  PayPalCheckButton: () =>
    createElement("button", null, "Check PayPal connection"),
}));
import { PayPalSetup } from "../../src/app/owner/(desk)/setup/paypal-setup";
it("shows configured payment settings without the initial get-keys call to action", () => {
  const html = renderToStaticMarkup(
    createElement(PayPalSetup, {
      mode: "sandbox",
      appUrl: "https://shop.example",
      configured: true,
    }),
  );
  expect(html).toContain("Sandbox configured");
  expect(html).not.toContain("Get your test keys");
  expect(html).not.toContain("Open PayPal sandbox");
  expect(html).toContain("Check PayPal connection");
});
it("retains sandbox setup guidance for a shop without credentials", () => {
  const html = renderToStaticMarkup(
    createElement(PayPalSetup, {
      mode: "sandbox",
      appUrl: "https://shop.example",
      configured: false,
    }),
  );
  expect(html).toContain("Get your test keys");
});
