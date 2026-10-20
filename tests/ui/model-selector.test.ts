// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelSelector } from "../../src/components/assistant/internal/model-selector";

let root: Root;
let container: HTMLDivElement;
const select = vi.fn();
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  container.className = "desk-theme";
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(ModelSelector, {
        title: "Reply model",
        value: "second",
        label: "Second model",
        description: "Current choice",
        choices: [
          {
            id: "first",
            label: "First model",
            description: "First",
            group: "Models",
          },
          {
            id: "second",
            label: "Second model",
            description: "Second",
            group: "Models",
          },
        ],
        onSelect: select,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  select.mockReset();
  vi.unstubAllGlobals();
});
it("opens with search focused and Enter retains the selected model rather than choosing the first", async () => {
  await act(async () => container.querySelector("button")!.click());
  const search = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
  expect(document.activeElement).toBe(search);
  await act(async () =>
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(select).toHaveBeenCalledWith("second");
  expect(document.querySelector("[cmdk-input]")).toBeNull();
});
it("Escape dismisses without changing the selected model", async () => {
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    document
      .querySelector("[cmdk-input]")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(select).not.toHaveBeenCalled();
  expect(document.querySelector("[cmdk-input]")).toBeNull();
});

it("keeps the model menu inside the active desk colour scope", async () => {
  await act(async () => container.querySelector("button")!.click());
  expect(
    container.querySelector("[data-radix-popper-content-wrapper]"),
  ).not.toBeNull();
});
