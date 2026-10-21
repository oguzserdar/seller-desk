// @vitest-environment happy-dom
/** @fileoverview The quote modal keeps the saved buyer palette and restores the external opener. */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { QuoteSheet } from "../../src/components/buyer/quote-sheet";

/** Polls inside act until the condition holds, failing after the timeout. */
async function waitUntil(condition: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

it("the externally opened library sheet is named, themed and returns focus after closing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Example() {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      { className: "buyer-page" },
      createElement("button", { onClick: () => setOpen(true) }, "Open quote"),
      createElement(QuoteSheet, {
        open,
        onClose: () => setOpen(false),
        children: "Actual quote content",
      }),
    );
  }
  try {
    await act(async () => root.render(createElement(Example)));
    const trigger = host.querySelector("button")!;
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.closest(".buyer-page")).not.toBeNull();
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Your quote");
    await act(async () => {
      dialog
        .querySelector<HTMLButtonElement>('[aria-label="Close your quote"]')!
        .click();
    });
    // The sheet stays mounted for its exit spring (about 300 ms) and Radix restores
    // focus after the unmount, so wait for that state instead of a fixed delay.
    await waitUntil(() => document.querySelector('[role="dialog"]') === null && document.activeElement === trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
