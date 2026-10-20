// @vitest-environment happy-dom
/** Browser recovery follows saved ownership and execution, without automatically replaying customer actions. */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChatStatus, UIMessage } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConversationSync, type BuyerHistory } from "../../src/components/buyer/use-conversation-sync";
import { ReplyRecovery } from "../../src/components/buyer/reply-recovery";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/buyer-client", () => ({ api }));
const stop = vi.fn(async () => {});
const clearError = vi.fn();
const setHandoff = vi.fn();
const customer: UIMessage = { id: "customer", role: "user", parts: [{ type: "text", text: "Can I collect on Friday?" }] };
const unsent: UIMessage = { id: "unsent", role: "user", parts: [{ type: "text", text: "Please keep the original finish." }] };
const partial: UIMessage = { id: "partial", role: "assistant", parts: [{ type: "text", text: "Let me check" }] };
let history: BuyerHistory;
let root: Root;
let container: HTMLDivElement;
let view: UIMessage[];
let initial: UIMessage[];
let status: ChatStatus;
let sync: ReturnType<typeof useConversationSync>;

function Harness() {
  const [messages, setMessages] = useState(initial);
  view = messages;
  sync = useConversationSync({ ready: true, messages, status, stop, clearError, setMessages, setHandoff });
  return createElement("p", null, messages.map(message => message.id).join(","));
}
async function mount() {
  await act(async () => { root.render(createElement(Harness)); });
  await act(async () => { sync.restore(history.control); });
  clearError.mockClear();
}
async function poll() { await act(async () => { document.dispatchEvent(new Event("visibilitychange")); }); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  initial = [customer]; status = "ready";
  history = { messages: [customer], assistant: true, handoff: null, replyState: "idle", control: { id: "conversation", handler: "seller", revision: 2 } };
  api.mockImplementation(async () => ({ data: history }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("keeps an undelivered customer message and its error during seller takeover", async () => {
  initial = [customer, unsent]; status = "error";
  await mount(); await poll();
  expect(view.map(message => message.id)).toEqual(["customer", "unsent"]);
  expect(clearError).not.toHaveBeenCalled();
});

it("stops revoked AI output while preserving the customer's pending text", async () => {
  initial = [customer, unsent, partial]; status = "streaming";
  history.control = { ...history.control, handler: "assistant", revision: 1 };
  await mount();
  history = { ...history, control: { ...history.control, handler: "seller", revision: 2 } };
  await poll();
  expect(stop).toHaveBeenCalledOnce();
  expect(view.map(message => message.id)).toEqual(["customer", "unsent"]);
});

it("shows the seller's durable reply once without inventing an assistant response", async () => {
  await mount();
  const reply: UIMessage = { id: "human", role: "assistant", parts: [{ type: "data-seller-reply", data: { text: "Friday is fine.", sentAt: "2026-10-11T12:00:00Z" } }] };
  history = { ...history, messages: [customer, reply] };
  await poll(); await poll();
  expect(view).toEqual([customer, reply]);
  expect(clearError).not.toHaveBeenCalled();
});

it("does not resurrect an old delivered customer message when it leaves the history window", async () => {
  await mount(); await poll();
  const humanMessages: UIMessage[] = Array.from({ length: 40 }, (_, index) => ({ id: `human-${index}`, role: "assistant", parts: [{ type: "data-seller-reply", data: { text: `Update ${index}`, sentAt: "2026-10-11T12:00:00Z" } }] }));
  history = { ...history, messages: humanMessages };
  await poll();
  expect(view).toEqual(humanMessages);
});

it("offers recovery only for the exact saved unanswered turn, then clears it on a durable reply", async () => {
  history = { ...history, replyState: "answering", control: { ...history.control, handler: "assistant" } };
  await mount(); await poll();
  expect(sync.replyState).toBe("answering");
  history = { ...history, replyState: "interrupted" }; await poll();
  expect(sync.replyState).toBe("interrupted");
  history = { ...history, replyState: "idle", messages: [customer, partial] }; await poll();
  expect(sync.replyState).toBe("idle");
});

it("does not attach a saved interrupted state to newer unsent text", async () => {
  initial = [customer, unsent];
  history = { ...history, replyState: "interrupted", control: { ...history.control, handler: "assistant" } };
  await mount(); await poll();
  expect(sync.replyState).toBe("idle");
  expect(view.at(-1)?.id).toBe("unsent");
});

it("waits for live execution and only continues an interrupted reply when the customer clicks", async () => {
  const onContinue = vi.fn();
  await act(async () => { root.render(createElement(ReplyRecovery, { state: "answering", onContinue })); });
  expect(container.textContent).toContain("still answering");
  expect(container.querySelector("button")).toBeNull();
  await act(async () => { root.render(createElement(ReplyRecovery, { state: "interrupted", onContinue })); });
  expect(container.textContent).toContain("Your message is saved");
  expect(onContinue).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toBe("Continue reply");
  await act(async () => { container.querySelector("button")?.click(); });
  expect(onContinue).toHaveBeenCalledOnce();
  await act(async () => { root.render(createElement(ReplyRecovery, { state: "idle", onContinue })); });
  expect(container.textContent).toBe("");
});
