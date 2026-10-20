// @vitest-environment happy-dom
/**
 * Owner forms post their choices like a plain select did: a "none" choice posts "",
 * a named choice posts its value, and the field is labelled for assistive tech.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChoiceSelect } from "../../src/components/choice-select";

let root: Root;
let container: HTMLDivElement;
function form(child: ReactElement) {
  act(() => root.render(null));
  act(() => root.render(createElement("form", { id: "f" }, child)));
  return new FormData(container.querySelector("form")!);
}

describe("ChoiceSelect in an owner form", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("posts an empty value for the 'all customers' choice, and the chosen product otherwise", () => {
    const options = [{ value: "", label: "All customers" }, { value: "p1", label: "Disc brake pads" }];
    expect(form(createElement(ChoiceSelect, { id: "a", label: "Applies to", name: "product", defaultValue: "", options })).get("product")).toBe("");
    expect(form(createElement(ChoiceSelect, { id: "a", label: "Applies to", name: "product", defaultValue: "p1", options })).get("product")).toBe("p1");
    expect(container.textContent).toContain("Disc brake pads");
  });

  it("posts a named choice without a 'none' option, and labels the control", () => {
    const options = [{ value: "replace", label: "Replace this rule" }, { value: "keep", label: "Keep both" }];
    const data = form(createElement(ChoiceSelect, { id: "d", label: "Which rule should apply?", name: "decision", defaultValue: "keep", options, required: true }));
    expect(data.get("decision")).toBe("keep");
    const trigger = container.querySelector("#d")!;
    expect(container.querySelector('label[for="d"]')?.textContent).toBe("Which rule should apply?");
    expect(trigger.getAttribute("role") ?? trigger.tagName).toMatch(/combobox|BUTTON/);
  });
});
