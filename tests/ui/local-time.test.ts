// @vitest-environment happy-dom
/** @fileoverview Owner times show in the viewer's time zone; the server's fallback is labelled UTC, never unlabelled. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LocalTime } from "../../src/components/local-time";

const paid = "2026-10-22T00:35:00.000Z";
const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

it("sends the exact instant with a UTC-labelled fallback from the server", () => {
  const html = renderToStaticMarkup(createElement(LocalTime, { value: paid, options }));
  expect(html).toContain(`dateTime="${paid}"`);
  expect(html).toContain("Oct 22, 12:35 AM UTC");
});

it("shows the viewer's local time once the page has loaded", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(LocalTime, { value: paid, options })));
    expect(host.textContent).toBe(new Intl.DateTimeFormat(undefined, options).format(new Date(paid)));
    expect(host.textContent).not.toContain("UTC");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
