// @vitest-environment happy-dom
/** @fileoverview The Desk shows one "needs you" number everywhere, and a customer's details as rows, not a dotted paragraph. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NeedsYou, TeachCard } from "../../src/app/owner/(desk)/orders/needs-you";
import { needsYouLabel } from "../../src/server/domain/desk-count";

const actions = vi.hoisted(() => ({ answerQuestionAction: vi.fn() }));
vi.mock("../../src/app/owner/(desk)/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next-safe-action/hooks", () => ({ useAction: () => ({ execute: vi.fn(), isPending: false, result: {} }) }));

const question = { id: "q1", conversationId: "c1", revision: 1, question: "Can you replace my front brake cable by Tuesday?", customerGoal: "Replace the front brake cable", knownFacts: ["Needed by Tuesday", "Budget under $125"], askedAt: "2026-10-14T02:03:00.000Z" };
const order = { id: "o1", ref: "#1001", items: "Disc brake pads", amount: "$35.00", nextStep: "Hand over at pickup", imagePath: null, href: "/owner/orders/o1" };
let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });

async function render(props: Parameters<typeof NeedsYou>[0]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(NeedsYou, props)); });
  return container;
}

it("words the count the same way everywhere", () => {
  expect(needsYouLabel(0)).toBe("Nothing needs you");
  expect(needsYouLabel(1)).toBe("1 needs you");
  expect(needsYouLabel(2)).toBe("2 need you");
});

it("counts questions and orders together in the section it heads", async () => {
  const container = await render({ questions: [question], orders: [order] });
  const section = container.querySelector("section[aria-label]")!;
  expect(section.getAttribute("aria-label")).toBe("Needs you: 2");
  expect(container.querySelectorAll("[data-needs-you-item]").length).toBe(2);
});

it("shows the question as the headline and each detail as its own row", async () => {
  const container = await render({ questions: [question], orders: [] });
  expect(container.textContent).toContain("Your assistant needs an answer");
  expect(container.textContent).not.toContain("·");
  const rows = [...container.querySelectorAll("[data-detail]")].map((row) => row.textContent);
  expect(rows).toEqual(["Replace the front brake cable", "Needed by Tuesday", "Budget under $125"]);
  const send = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Send to customer"))!;
  expect(send.disabled).toBe(true);
});

it("says plainly when nothing needs the owner", async () => {
  const container = await render({ questions: [], orders: [] });
  expect(container.textContent).toContain("Nothing needs you");
});

it("invites the owner to teach the assistant only when there are answers to review", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(TeachCard, { count: 2 })); });
  expect(container.textContent).toContain("Teach your assistant");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/owner/knowledge/reviews");
  expect(container.textContent).toContain("Review 2 answers");
  await act(async () => { root!.render(createElement(TeachCard, { count: 0 })); });
  expect(container.textContent).toBe("");
});
