// @vitest-environment happy-dom
/** Browser-state contracts only; action responses are labeled synthetic and no AI model is mocked. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstructionPreview } from "../../src/app/owner/(desk)/knowledge/instructions/instruction-preview";
import { previewInstructionAction } from "../../src/app/owner/(desk)/knowledge/instructions/actions";
import type { ProcedurePreviewView } from "@/lib/procedure-preview";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/knowledge/instructions/actions", () => ({ previewInstructionAction: vi.fn() }));
const saved = { id: "bcf2c8f1-ecbd-49f8-b58a-31927d8be119", revision: 2, publishedRevision: 1, archived: false, content: { title: "Urgent repair", whenToUse: "The customer needs an urgent repair.", steps: "Ask for the wheel diameter before asking the seller to confirm availability." } };
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.clearAllMocks();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);container = document.createElement("div");document.body.appendChild(container);root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount());container.remove();vi.unstubAllGlobals(); });
async function render(dirty = false, reports: ProcedurePreviewView[] = []) { await act(async () => root.render(createElement(InstructionPreview, { saved, dirty, busy: false, modelConnected: true, reports }))); }
async function question(text: string) { await act(async () => { const area = container.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);area.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));await new Promise(resolve => setTimeout(resolve, 0)); }); }
it("refuses to test unsaved wording even when form submission is dispatched directly", async () => {
  await render(true);await question("Can you repair my bicycle before Friday?");await submit();
  expect(previewInstructionAction).not.toHaveBeenCalled();expect(container.textContent).toContain("Save your edits first");
});
it("submits only the saved revision and reuses the same request after a transport-style failure", async () => {
  vi.mocked(previewInstructionAction).mockResolvedValue({ serverError: "Synthetic action failure; no model answer." });
  await render();await question("Can you repair my bicycle before Friday?");await submit();await submit();
  const [first, second] = vi.mocked(previewInstructionAction).mock.calls;
  expect(first?.[0]).toMatchObject({ procedureId: saved.id, expectedRevision: 2, question: "Can you repair my bicycle before Friday?" });
  expect(first).toEqual(second);expect(first?.[0]).not.toHaveProperty("content");
  await question("I changed my deadline to Monday. What do you need?");await submit();
  expect(vi.mocked(previewInstructionAction).mock.calls[2]?.[0]?.requestId).not.toBe(first?.[0]?.requestId);
});
it("labels stale partial results without a synthetic successful replacement for the missing reply", async () => {
  const report: ProcedurePreviewView = { id: crypto.randomUUID(), procedureId: saved.id, revision: 1, publishedRevision: null, question: "A fictional storage test question?", wording: saved.content, generator: "synthetic-storage-only", state: "failed", current: { text: "SYNTHETIC stored result, not an AI reply.", latencyMs: 1, inputTokens: null, outputTokens: null, reads: ["read_shop_facts"] }, proposed: null, failure: "Synthetic provider failure.", createdAt: "2026-10-11T00:00:00.000Z" };
  await render(false, [report]);
  expect(container.textContent).toContain("Comparison unfinished");expect(container.textContent).toContain("Earlier wording");expect(container.textContent).toContain("No completed reply saved.");
  expect(container.textContent).not.toContain("Both replies saved");expect(previewInstructionAction).not.toHaveBeenCalled();
});
