// @vitest-environment happy-dom
/** UI request/recovery boundaries only. No AI answer or successful action response is supplied. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SimulationWorkspace } from "../../src/app/owner/(desk)/knowledge/tests/workspace";
import { runSimulationAction } from "../../src/app/owner/(desk)/knowledge/tests/actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/knowledge/tests/actions", () => ({ runSimulationAction: vi.fn() }));
let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(connected: boolean) { await act(async () => root.render(createElement(SimulationWorkspace, { connected, reports: [], offers: [], instructions: [] }))); }
async function fill(index: number, text: string) { await act(async () => { const field = container.querySelectorAll("textarea")[index]!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)); }); }
it("cannot bypass the disconnected gate by dispatching form submission", async () => {
  await render(false); await fill(0, "Isabel needs a repair by Friday."); await fill(1, "Ask the seller before promising a time."); await submit();
  expect(runSimulationAction).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Connect your assistant");
  expect(container.textContent).toContain("Run your first test");
});
it("keeps the same request after a connection failure and changes it when the plan changes", async () => {
  vi.mocked(runSimulationAction).mockResolvedValue({ serverError: "Synthetic connection failure; no AI reply supplied." });
  await render(true); await fill(0, "Isabel needs a repair by Friday."); await fill(1, "Ask the seller before promising a time."); await submit(); await submit();
  const [first, second] = vi.mocked(runSimulationAction).mock.calls;
  expect(first).toEqual(second);
  expect(first?.[0]).toMatchObject({ scenario: "Isabel needs a repair by Friday.", change: { kind: "none" }, steps: [] });
  expect(first?.[0]).not.toHaveProperty("snapshot"); expect(first?.[0]).not.toHaveProperty("database");
  await fill(0, "Isabel asks for an impossible refund without an order."); await submit();
  expect(vi.mocked(runSimulationAction).mock.calls[2]?.[0]?.requestId).not.toBe(first?.[0]?.requestId);
});
