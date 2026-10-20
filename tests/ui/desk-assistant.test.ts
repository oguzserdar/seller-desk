import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeskAssistant } from "../../src/app/owner/(desk)/desk-assistant";

const chat = vi.hoisted(() => ({ messages: [] as unknown[], decisions: {} as Record<string, {state: string; message: string}> }));
vi.mock("../../src/app/owner/(desk)/desk-chat-context", () => ({ useDeskChat: () => ({ chat: {}, history: { messages: [], interrupted: false, busyUntil: null, decisions: chat.decisions } }) }));
vi.mock("@ai-sdk/react", () => ({ useChat: () => ({ ...chat, status: "ready", sendMessage: vi.fn(), clearError: vi.fn(), stop: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-safe-action/hooks", () => ({ useAction: () => ({ result: {}, execute: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/actions", () => ({ decideProposalAction: vi.fn() }));

const rows = [
  { id: "one", ref: "#1001", items: "Download", nextStep: "Done", needsOwner: false, href: "/owner/orders/one", imagePath: null },
  { id: "two", ref: "#1002", items: "Mug", nextStep: "Hand over at pickup", needsOwner: true, href: "/owner/orders/two", imagePath: null },
];
const render = (type: string) => {
  chat.messages = [{ id: "reply", role: "assistant", parts: [{ type, toolCallId: "read", state: "output-available", input: {}, output: { rows } }] }];
  return renderToStaticMarkup(createElement(DeskAssistant, { assistantOn: true }));
};

beforeEach(() => { chat.messages = []; chat.decisions = {}; });

describe("relevant desk cards", () => {
  it("does not display every background read as an order recommendation", () => {
    expect(render("tool-query_desk")).not.toContain("#1002");
  });
  it("displays all deliberately selected cards, including completed orders", () => {
    const html = render("tool-show_desk_rows");
    expect(html).toContain("#1001");
    expect(html).toContain("#1002");
  });
});

it("shows saved decisions rather than approval buttons after a reload", () => {
  chat.messages = [{ id: "proposal", role: "assistant", parts: [{ type: "tool-propose_action", toolCallId: "p", state: "output-available", input: {}, output: { proposalId: "saved", summary: "Mark as picked up?", consequence: "No charge", approveLabel: "Mark picked up" } }] }];
  for (const state of ["rejected", "executed", "expired", "unconfirmed"]) {
    chat.decisions = { saved: { state, message: "Saved decision: " + state } };
    const html = renderToStaticMarkup(createElement(DeskAssistant, { assistantOn: true }));
    expect(html).toContain("Saved decision: " + state);
    expect(html).not.toContain("Not now");
    expect(html).not.toContain(">Mark picked up</button>");
  }
});
