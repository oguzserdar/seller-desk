// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerConversation } from "../../src/app/owner/(desk)/conversations/customer-conversation";
import type { SellerConversation } from "../../src/server/domain/conversation-messages";

const actions = vi.hoisted(() => ({
  refreshConversationAction: vi.fn(),
  controlConversationAction: vi.fn(),
  replyToConversationAction: vi.fn(),
}));
vi.mock("../../src/app/owner/(desk)/conversations/actions", () => actions);
vi.mock("@/components/assistant/conversation", () => ({
  ShopConversation: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
  AssistantAnswer: ({ text }: { text: string }) =>
    createElement("p", null, text),
}));
let view: SellerConversation;
let root: Root;
let container: HTMLDivElement;
async function type(text: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectQuestion() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  view = {
    control: { id: "conversation", handler: "seller", revision: 2 },
    messages: [],
    pending: { id: "question", revision: 1, question: "Can I collect Friday?" },
  };
  actions.refreshConversationAction.mockImplementation(async () => ({
    data: view,
  }));
  actions.replyToConversationAction.mockResolvedValue({
    serverError: "The request changed.",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(CustomerConversation, { initial: view }));
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("recognizes a committed reply after its action response is lost", async () => {
  actions.replyToConversationAction.mockImplementation(async (input) => {
    view = {
      ...view,
      pending: null,
      messages: [
        {
          id: input.id,
          role: "assistant",
          parts: [
            {
              type: "data-seller-reply",
              data: { text: input.text, sentAt: new Date().toISOString() },
            },
          ],
        },
      ],
    };
    throw new Error("Connection lost after commit");
  });
  await type("Friday at noon works.");
  await selectQuestion();
  await submit();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(actions.replyToConversationAction).toHaveBeenCalledOnce();
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(container.textContent).toContain("Reply saved for the customer.");
  expect(container.textContent).not.toContain("Could not send");
});

it("does not silently apply an already checked answer to a revised customer request", async () => {
  await type("Friday at noon works.");
  await selectQuestion();
  view = {
    ...view,
    pending: {
      ...view.pending!,
      revision: 2,
      question: "Actually, can I collect Thursday?",
    },
  };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await submit();
  expect(actions.replyToConversationAction).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe(
    "Friday at noon works.",
  );
  expect(container.textContent).toContain("The request changed");
});

it("a demo visitor reads an owner-held conversation without Take over or a reply form", async () => {
  await act(async () => {
    root.render(createElement(CustomerConversation, { initial: view, readOnly: true }));
  });
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("textarea")).toBeNull();
  expect([...container.querySelectorAll("button")].some((button) => /Take over|Return to assistant/.test(button.textContent ?? ""))).toBe(false);
  expect(container.textContent).toContain("The owner can take over here");
});
