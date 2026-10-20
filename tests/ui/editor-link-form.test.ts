// @vitest-environment happy-dom
/** @fileoverview A formatting action must never submit the containing instruction form. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RichTextEditor } from "../../src/components/arc/rich-text-editor/rich-text-editor";

it.each(["button", "Enter"])("applies a link with %s without nesting a form or submitting the owner's draft", async (method) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const saved = vi.fn(), changed = vi.fn(), host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const before = new Map(["getClientRects", "getBoundingClientRect"].map(key => [key, Object.getOwnPropertyDescriptor(Range.prototype, key)]));
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [new DOMRect(10, 100, 120, 20)] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(10, 100, 120, 20) });
  try {
    await act(async () => root.render(createElement("form", { onSubmit: event => { event.preventDefault(); saved(); } }, createElement(RichTextEditor, { defaultMarkdown: "Ask the seller first.", onChange: changed }))));
    const area = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
    await act(async () => {
      area.focus();
      const range = document.createRange(); range.selectNodeContents(area);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    const link = host.querySelector<HTMLButtonElement>('[aria-label="Link"]');
    expect(link).not.toBeNull();
    await act(async () => { link!.click(); await new Promise(resolve => setTimeout(resolve, 60)); });
    expect(host.querySelector("form form")).toBeNull();
    const field = host.querySelector<HTMLInputElement>('[aria-label="Link address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "https://example.com/service");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const apply = host.querySelector<HTMLButtonElement>('[aria-label="Apply link"]')!;
    expect(apply.type).toBe("button");
    await act(async () => {
      if (method === "button") apply.click();
      else {
        const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        field.dispatchEvent(key);
        expect(key.defaultPrevented).toBe(true);
      }
    });
    expect(saved).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: "[Ask the seller first.](https://example.com/service)" }));
  } finally {
    await act(async () => root.unmount()); host.remove();
    for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(Range.prototype, key, descriptor); else Reflect.deleteProperty(Range.prototype, key); }
    vi.unstubAllGlobals();
  }
});
