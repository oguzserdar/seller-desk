// @vitest-environment happy-dom
/**
 * A demo visitor sees which AI is connected, never a field to paste a key into.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../../src/app/owner/(desk)/setup/ai-settings", () => ({ AiSettings: () => createElement("input", { "aria-label": "Anthropic key" }) }));
import { AiSetup } from "../../src/app/owner/(desk)/setup/ai-setup";

it("shows the connection read-only, with no key field, for a demo visitor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const connection = { source: "environment", provider: "anthropic", modelId: "claude-sonnet-5-5", keyMask: "hidden in the demo", unreadable: false } as const;
  await act(async () => {
    root.render(createElement(AiSetup, { readOnly: true, connection, reply: "r", routing: "off", routine: "none" }));
  });
  expect(container.querySelector("input")).toBeNull();
  expect(container.textContent).toContain("Anthropic");
  expect(container.textContent).toContain("claude-sonnet-5-5");
  expect(container.textContent).toContain("Set, hidden in the demo");
  await act(async () => {
    root.render(createElement(AiSetup, { connection, reply: "r", routing: "off", routine: "none" }));
  });
  expect(container.querySelector("input")).not.toBeNull();
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
