// @vitest-environment happy-dom
/** Approvals stay in the page, bind the exact note/revision and survive a refused stale action. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskActions } from "../../src/app/owner/(desk)/orders/[id]/task-actions";
const actions = vi.hoisted(() => ({ completePickupAction: vi.fn(), completeServiceWorkAction: vi.fn(), retryAccessAction: vi.fn(), serviceFollowUpAction: vi.fn() }));
vi.mock("../../src/app/owner/(desk)/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
async function write(text: string) {
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  expect(button, `Button: ${label}`).toBeDefined();
  await act(async () => { button!.click(); });
}

it("requires an inline second approval for time, supports cancel, and never opens a native popup", async () => {
  await act(async () => { root.render(createElement(TaskActions, { orderId: "order", accessReview: null, task: { id: "time", type: "service_followup", state: "pending", revision: 1 } })); });
  await write("Monday 10am, agreed with buyer."); await click("Time confirmed");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(actions.serviceFollowUpAction).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Record the time as agreed with the buyer?");
  await click("Keep editing");
  expect(actions.serviceFollowUpAction).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")?.value).toBe("Monday 10am, agreed with buyer.");
});

it("also keeps pickup behind an explicit confirmation", async () => {
  actions.completePickupAction.mockResolvedValue({ serverError: "Stale pickup" });
  await act(async () => { root.render(createElement(TaskActions, { orderId: "order", accessReview: null, task: { id: "pickup", type: "pickup", state: "pending", revision: 3 } })); });
  await click("Mark picked up");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(actions.completePickupAction).not.toHaveBeenCalled();
  await click("Confirm pickup");
  expect(actions.completePickupAction).toHaveBeenCalledWith({ taskId: "pickup", expectedRevision: 3, note: "" });
});

it("shows the buyer-visible completion note, invalidates approval on edits and submits only the reviewed revision", async () => {
  actions.completeServiceWorkAction.mockResolvedValue({ serverError: "This service changed. Review it again." });
  const props = { orderId: "order", accessReview: null, task: { id: "work", type: "service_work" as const, state: "pending", revision: 1 } };
  await act(async () => { root.render(createElement(TaskActions, props)); });
  await write("Front cable replaced."); await click("Mark work finished");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(actions.completeServiceWorkAction).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Front cable replaced.");
  await write("Front cable and pads replaced.");
  expect([...container.querySelectorAll("button")].some(button => button.textContent === "Confirm finished work")).toBe(false);
  await click("Mark work finished");
  await act(async () => { root.render(createElement(TaskActions, { ...props, task: { ...props.task, revision: 2 } })); });
  await click("Confirm finished work");
  expect(actions.completeServiceWorkAction).toHaveBeenCalledWith({ taskId: "work", expectedRevision: 1, note: "Front cable and pads replaced." });
  expect(container.textContent).toContain("This service changed. Review it again.");
  expect(container.querySelector("textarea")?.value).toBe("Front cable and pads replaced.");
});
