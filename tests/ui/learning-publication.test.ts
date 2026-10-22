// @vitest-environment happy-dom
/** @fileoverview Approved learning must show its published wording, not obsolete unresolved prompts. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReviewWorkspace } from "../../src/app/owner/(desk)/knowledge/reviews/review-workspace";
import {
  saveReviewDraftAction,
  publishReviewAction,
} from "../../src/app/owner/(desk)/knowledge/reviews/actions";
import type { LearningWorkspaceItem } from "@/lib/learning-review";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/knowledge/reviews/actions", () => ({
  previewReviewAction: vi.fn(),
  decideReviewAction: vi.fn(),
  generateReviewAction: vi.fn(),
  publishReviewAction: vi.fn(),
  saveReviewDraftAction: vi.fn(),
}));
it("shows approved facts without continuing to ask resolved review questions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const source = {
    questionId: "question",
    sourceRevision: 1,
    question: "When can I collect?",
    answer: "Pickup ends at 6pm.",
    customerGoal: "Collect",
    knownFacts: [],
    terms: {
      policyRevision: 1,
      sellerName: "Shop",
      pickupPolicy: null,
      serviceRequestPolicy: null,
      digitalAccessPolicy: null,
      cancellationPolicy: null,
      taxPolicy: null,
    },
    products: [],
    guides: [],
  };
  const item: LearningWorkspaceItem = {
    questionId: source.questionId,
    question: source.question,
    answer: source.answer,
    customerGoal: source.customerGoal,
    review: {
      id: "bde2dd14-3790-4f46-b359-9d28265c8065",
      revision: 2,
      state: "draft",
      stale: false,
      source,
      editedDrafts: [],
      analysis: {
        summary: "Pickup fact",
        findings: [
          {
            kind: "reusable_fact",
            title: "Pickup hours",
            explanation: "Normal closing time.",
            answerQuote: source.answer,
            proposedFact: source.answer,
            scope: "All pickups",
            questions: ["Which timezone applies?"],
            conflictingPolicyFields: [],
            conflictingProductIds: [],
            coveredByGuideIds: [],
            conflictingGuideIds: [],
          },
        ],
      },
      publications: [
        {
          id: "publication",
          findingIndex: 0,
          guideId: "guide",
          guideRevision: 1,
          title: "Pickup hours",
          body: "Pickup ends at 6pm Edmonton time.",
          current: true,
        },
      ],
    },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(ReviewWorkspace, {
          items: [item],
          modelConnected: true,
          products: [],
        }),
      );
    });
    expect(container.textContent).toContain("Ready for the next customer");
    expect(container.textContent).toContain(
      "Pickup ends at 6pm Edmonton time.",
    );
    expect(container.textContent).not.toContain("Still needs your answer");
    expect(container.textContent).not.toContain(
      "Suggested wording · not published",
    );
    const restored = {
      ...item,
      review: {
        ...item.review!,
        publications: [],
        editedDrafts: [
          {
            findingIndex: 0,
            title: "Edited hours",
            body: "Saved edited wording for future customers.",
            topic: "general" as const,
            productId: null,
            validUntil: null,
            clarification: "Edmonton local time.",
            conflicts: [],
          },
        ],
      },
    };
    await act(async () => {
      root.render(
        createElement(ReviewWorkspace, {
          items: [restored],
          modelConnected: true,
          products: [],
        }),
      );
    });
    const edit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Edit for future customers",
    );
    await act(async () => {
      edit!.click();
    });
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[name="body"]')
        ?.value,
    ).toBe("Saved edited wording for future customers.");
    expect(container.textContent).toContain("Save draft");
    expect(
      container.querySelector<HTMLInputElement>('input[name="reusable"]')
        ?.checked,
    ).toBe(false);
    // Approving without the confirmation names the box to tick, rather than relying on a browser bubble
    // anchored to the hidden native input, which nobody sees.
    const approve = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Approve for future customers",
    )!;
    await act(async () => {
      approve.click();
    });
    expect(container.textContent).toContain("Tick “I reviewed this wording” to approve.");
    expect(publishReviewAction).not.toHaveBeenCalled();
    const visibleApproval =
      container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    await act(async () => {
      visibleApproval.click();
    });
    expect(visibleApproval.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      const title = container.querySelector<HTMLInputElement>(
        'input[name="title"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(title, "Revised reviewed hours");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(visibleApproval.getAttribute("aria-checked")).toBe("false");
    vi.mocked(saveReviewDraftAction).mockResolvedValue({
      data: { revision: 3 },
    });
    vi.mocked(publishReviewAction).mockResolvedValue({
      data: { id: "publication", guideId: "guide", guideRevision: 1 },
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save draft",
    );
    await act(async () => {
      saveButton!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saveReviewDraftAction).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 2,
        draft: expect.objectContaining({
          body: "Saved edited wording for future customers.",
        }),
      }),
    );
    expect(container.textContent).toContain("Draft saved privately");
    expect(
      container.querySelector<HTMLInputElement>('input[name="reusable"]')
        ?.checked,
    ).toBe(false);
    // A server refresh must not grant old open wording the newest revision.
    await act(async () => {
      root.render(
        createElement(ReviewWorkspace, {
          items: [
            { ...restored, review: { ...restored.review, revision: 99 } },
          ],
          modelConnected: true,
          products: [],
        }),
      );
    });
    const approval =
      container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    await act(async () => {
      approval.click();
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(publishReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 3, confirmReusable: true }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
