// @vitest-environment happy-dom
/** @fileoverview Prevents aria-disabled and pending buttons from repeating actions while retaining focus and a readable label. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "../../src/components/arc/button/button";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => vi.restoreAllMocks());
it.each([
  { loading: true },
  { "aria-disabled": true },
  { "aria-disabled": "true" as const },
])("refuses another action while unavailable: %j", async (props) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    click = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(Button, { ...props, onClick: click }, "Save changes"),
      ),
    );
    const button = host.querySelector("button")!;
    button.focus();
    await act(async () => button.click());
    expect(click).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toContain("Save changes");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
