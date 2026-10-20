// @vitest-environment happy-dom
/** @fileoverview The learning screen teaches by example on first use and leads each finding with the fact customers will be told. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewWorkspace } from "../../src/app/owner/(desk)/knowledge/reviews/review-workspace";
import type { LearningWorkspaceItem } from "@/lib/learning-review";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/knowledge/reviews/actions", () => ({ previewReviewAction: vi.fn(), decideReviewAction: vi.fn(), generateReviewAction: vi.fn(), publishReviewAction: vi.fn(), saveReviewDraftAction: vi.fn() }));

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function render(items: LearningWorkspaceItem[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(createElement(ReviewWorkspace, { items, modelConnected: true, products: [] })); });
  return container;
}
const base = { conflictingGuideIds: [], coveredByGuideIds: [], conflictingPolicyFields: [], conflictingProductIds: [], questions: [] };

it("shows a labelled example instead of an empty page on first use", async () => {
  const container = await render([]);
  expect(container.textContent).toContain("Example. Nothing is published.");
  expect(container.textContent).toContain("No answers to review yet.");
});

it("leads with the public fact and keeps the one-off favour in its own private group, below", async () => {
  const answer = "Yes, the side entrance is step-free. Isabel can come at 18:00 Friday.";
  const source = { questionId: "q", sourceRevision: 1, question: "Is there a way in without steps?", answer, customerGoal: "Visit", knownFacts: [], terms: {}, products: [], guides: [] } as unknown as NonNullable<LearningWorkspaceItem["review"]>["source"];
  const item: LearningWorkspaceItem = { questionId: "q", question: source.question, answer, customerGoal: "Visit", review: { id: "bde2dd14-3790-4f46-b359-9d28265c8065", revision: 1, state: "draft", stale: false, source, editedDrafts: [], publications: [],
    analysis: { summary: "One fact, one favour.", findings: [
      { ...base, kind: "customer_exception", title: "Late pickup for Isabel", explanation: "A one-off favour.", answerQuote: "Isabel can come at 18:00 Friday.", proposedFact: null, scope: "This customer" },
      { ...base, kind: "reusable_fact", title: "Step-free entrance", explanation: "Useful to every visitor.", answerQuote: "the side entrance is step-free", proposedFact: "The side entrance is step-free.", scope: "All visitors" },
    ] } } };
  const container = await render([item]);
  const text = container.textContent!;
  expect(text.indexOf("The next customer will be told")).toBeGreaterThan(-1);
  expect(text.indexOf("The next customer will be told")).toBeLessThan(text.indexOf("Stays between you and this customer"));
  expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toContain("The side entrance is step-free.");
});
