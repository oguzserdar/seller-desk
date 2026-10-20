// @vitest-environment happy-dom
/** @fileoverview Buyer input keeps its named field, input limit and stop boundary when using the library composer. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ChatComposer } from "../../src/components/arc/chat-thread/chat-thread";
import { Composer } from "../../src/components/buyer/composer";

it("the library accepts the buyer's native input attributes without changing its visuals", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(ChatComposer, {
          onSend: vi.fn(),
          allowAttachments: false,
          maxLength: 4000,
          ariaLabel: "Ask Test shop",
          autoFocus: true,
        }),
      ),
    );
    const field = host.querySelector("textarea")!;
    expect(field.getAttribute("aria-label")).toBe("Ask Test shop");
    expect(field.maxLength).toBe(4000);
    expect(document.activeElement).toBe(field);
    expect(host.querySelector('input[type="file"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("stopping a reply cannot send an extra customer message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    send = vi.fn(),
    stop = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          shopName: "Test shop",
          onSend: send,
          onStop: stop,
          streaming: true,
          disabled: false,
          placeholder: "Ask a question",
        }),
      ),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Stop the reply"]')!
        .click(),
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.click(),
    );
    expect(send).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
