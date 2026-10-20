// @vitest-environment happy-dom
/** Synthetic action responses verify editor state only; no AI answer is mocked. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstructionEditor } from "../../src/app/owner/(desk)/knowledge/instructions/instruction-editor";
import {
  instructionHistoryAction,
  pauseInstructionAction,
  publishInstructionAction,
  saveInstructionAction,
} from "../../src/app/owner/(desk)/knowledge/instructions/actions";
import type { ProcedureEditorValue } from "@/lib/assistant-procedure";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/knowledge/instructions/actions", () => ({
  saveInstructionAction: vi.fn(),
  publishInstructionAction: vi.fn(),
  pauseInstructionAction: vi.fn(),
  restoreInstructionAction: vi.fn(),
  instructionHistoryAction: vi.fn(),
  previewInstructionAction: vi.fn(),
}));
const row: ProcedureEditorValue = {
  id: "bcf2c8f1-ecbd-49f8-b58a-31927d8be119",
  revision: 1,
  publishedRevision: null,
  archived: false,
  content: {
    title: "Urgent repairs",
    whenToUse: "A customer has a deadline.",
    steps:
      "Ask the customer when the repair is needed before checking with the seller.",
  },
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function render(initial: ProcedureEditorValue | null = row) {
  await act(async () =>
    root.render(
      createElement(InstructionEditor, { initial, onClose: vi.fn() }),
    ),
  );
}
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
    await tick();
  });
}
async function editSteps(value: string) {
  const input = container.querySelector<HTMLElement>(
    '[role="textbox"][contenteditable="true"]',
  )!;
  await act(async () => {
    input.textContent = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function approve() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
  });
}

it("requires explicit approval and revokes it when wording changes", async () => {
  await render();
  expect(button("Publish saved version").disabled).toBe(true);
  await approve();
  expect(button("Publish saved version").disabled).toBe(false);
  await editSteps(
    "Ask for the wheel diameter before taking the request to the seller.",
  );
  expect(button("Publish saved version").disabled).toBe(true);
  expect(
    container.querySelector('[role="checkbox"]')!.getAttribute("aria-checked"),
  ).toBe("false");
  await click("Publish saved version");
  expect(publishInstructionAction).not.toHaveBeenCalled();
});

it("keeps the reviewed revision after a server refresh and publishes only that version", async () => {
  vi.mocked(publishInstructionAction).mockResolvedValue({
    data: { ...row, publishedRevision: 1 },
  });
  await render();
  await render({
    ...row,
    revision: 99,
    content: {
      ...row.content,
      steps:
        "Unseen newer saved wording must not inherit approval from this editor.",
    },
  });
  await approve();
  await click("Publish saved version");
  expect(publishInstructionAction).toHaveBeenCalledWith({
    id: row.id,
    expectedRevision: 1,
    approve: true,
  });
});

it("saving a changed draft retains the live version and requires fresh publication approval", async () => {
  const edited =
    "Ask for the wheel diameter before taking the request to the seller.";
  vi.mocked(saveInstructionAction).mockResolvedValue({
    data: {
      ...row,
      revision: 2,
      publishedRevision: 1,
      content: { ...row.content, steps: edited },
    },
  });
  await render({ ...row, publishedRevision: 1 });
  await editSteps(edited);
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
  expect(saveInstructionAction).toHaveBeenCalledWith({
    id: row.id,
    expectedRevision: 1,
    content: { ...row.content, steps: edited },
  });
  expect(publishInstructionAction).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Customers use version 1");
  expect(container.textContent).toContain("Version 2 is a private draft");
  expect(button("Publish saved version").disabled).toBe(true);
});

it("pauses live use without discarding unsaved local edits", async () => {
  vi.mocked(pauseInstructionAction).mockResolvedValue({
    data: { ...row, revision: 2, publishedRevision: null },
  });
  await render({ ...row, publishedRevision: 1 });
  const edited =
    "Keep these unsaved directions while the current instruction is paused.";
  await editSteps(edited);
  await click("Pause instruction");
  expect(pauseInstructionAction).toHaveBeenCalledWith({
    id: row.id,
    expectedRevision: 1,
    archive: false,
  });
  expect(
    container.querySelector<HTMLElement>(
      '[role="textbox"][contenteditable="true"]',
    )!.textContent,
  ).toBe(edited);
  expect(container.textContent).toContain("Unsaved changes");
  expect(button("Publish saved version").disabled).toBe(true);
});

it("does not archive before the separate confirmation or call publication after a server error", async () => {
  vi.mocked(publishInstructionAction).mockResolvedValue({
    serverError: "This instruction changed. Reload it before continuing.",
  });
  await render();
  await click("Archive");
  expect(pauseInstructionAction).not.toHaveBeenCalled();
  await click("Keep instruction");
  await approve();
  await click("Publish saved version");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "This instruction changed",
  );
  expect(container.textContent).toContain("Not in use");
});

it("loads history on demand and prevents restoration over unsaved edits", async () => {
  vi.mocked(instructionHistoryAction).mockResolvedValue({
    data: {
      versions: [
        {
          revision: 1,
          content: row.content,
          savedAt: "2026-10-11T00:00:00.000Z",
        },
      ],
    },
  });
  await render({ ...row, revision: 2 });
  expect(instructionHistoryAction).not.toHaveBeenCalled();
  await click("Version history");
  expect(instructionHistoryAction).toHaveBeenCalledWith({ id: row.id });
  await editSteps(
    "Keep the customer's latest deadline before asking the seller to decide.",
  );
  expect(button("Restore version 1 as draft").disabled).toBe(true);
});

it("saves formatted instructions as Markdown without storing editor HTML", async () => {
  await render();
  const editor = container.querySelector<HTMLElement>(
    '[role="textbox"][contenteditable="true"]',
  );
  expect(editor).not.toBeNull();
  await act(async () => {
    editor!.innerHTML =
      "<p>Ask <strong>which brake is damaged</strong> before asking the seller to confirm availability.</p>";
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save draft");
  expect(saveInstructionAction).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({
        steps:
          "Ask **which brake is damaged** before asking the seller to confirm availability.",
      }),
    }),
  );
});

it("refuses oversized rich-text instructions before calling the save action", async () => {
  await render();
  const editor = container.querySelector<HTMLElement>(
    '[role="textbox"][contenteditable="true"]',
  );
  expect(editor).not.toBeNull();
  await act(async () => {
    editor!.textContent = "x".repeat(2001);
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save draft");
  expect(saveInstructionAction).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("an instruction between 20 and 2,000 characters");
});
