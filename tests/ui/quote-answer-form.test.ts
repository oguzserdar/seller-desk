// @vitest-environment happy-dom
/** @fileoverview Optional combined replies remain bound to the question the owner actually read. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ScopeReview } from "../../src/app/owner/(desk)/quotes/[id]/scope-review";
const actions = vi.hoisted(() => ({ approveScopeAction: vi.fn(), declineQuoteAction: vi.fn() }));
vi.mock("../../src/app/owner/(desk)/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** A button's name as assistive tech reads it: Arc crossfades labels, and the outgoing one is aria-hidden. */
const named = (root: HTMLElement, name: string) => [...root.querySelectorAll("button")].find((b) => [...b.querySelectorAll("span")].some((span) => span.textContent === name && !span.closest("[aria-hidden=true]")) || b.textContent === name);
it("starts blank and does not apply a typed answer to a refreshed different question", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actions.approveScopeAction.mockResolvedValue({ serverError: "The request changed." });
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const props = { quoteId: "quote", revision: 1, defaultScope: "Front brake only", currency: "USD", lines: [{ offerId: "service", title: "Brake service", quantity: 1, unitAmountMinor: 12000 }], pendingQuestion: { id: "question", revision: 1, question: "Can you finish by Tuesday?" } };
  try {
    await act(async () => { root.render(createElement(ScopeReview, props)); });
    expect(container.querySelector<HTMLTextAreaElement>("#quote-answer")!.value).toBe("");
    await act(async () => { named(container, "Send quote to customer")!.click(); });
    expect(actions.approveScopeAction.mock.calls[0]?.[0].answer).toBeUndefined();
    actions.approveScopeAction.mockClear();
    await act(async () => {
      const input = container.querySelector<HTMLTextAreaElement>("#quote-answer")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Tuesday is not confirmed.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { root.render(createElement(ScopeReview, { ...props, pendingQuestion: { ...props.pendingQuestion, revision: 2, question: "Can you finish Monday instead?" } })); });
    expect(container.textContent).toContain("Can you finish by Tuesday?");
    expect(container.textContent).not.toContain("Can you finish Monday instead?");
    await act(async () => { named(container, "Send quote and answer")!.click(); });
    expect(actions.approveScopeAction).toHaveBeenCalledWith(expect.objectContaining({ answer: { questionId: "question", expectedRevision: 1, answer: "Tuesday is not confirmed." } }));
    expect(container.textContent).toContain("The request changed.");
    expect(container.querySelector<HTMLTextAreaElement>("#quote-answer")!.value).toBe("Tuesday is not confirmed.");
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks(); }
});

it("replaces the form with a sent confirmation once the quote is sent, instead of showing the same form again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actions.approveScopeAction.mockResolvedValue({ data: { quoteId: "quote-2", revision: 2, status: "review_ready" } });
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const props = { quoteId: "quote", revision: 1, defaultScope: "Replace the front brake cable", currency: "USD", lines: [{ offerId: "service", title: "Brake service", quantity: 1, unitAmountMinor: 9500 }] };
  try {
    await act(async () => { root.render(createElement(ScopeReview, props)); });
    await act(async () => { named(container, "Send quote to customer")!.click(); });
    expect(container.textContent).toContain("Quote sent to the customer");
    expect(container.textContent).toContain("$95.00");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/owner/quotes/quote-2"]')).not.toBeNull();
    expect(named(container, "Send quote to customer")).toBeUndefined();
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks(); }
});
