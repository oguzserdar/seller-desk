// @vitest-environment happy-dom
/** A failed theme save must not leave the rejected option selected. */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deskThemeStyle, type DeskThemeId } from "../../src/lib/desk-themes";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), action: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../../src/app/owner/(desk)/setup/actions", () => ({
  setDeskThemeAction: mocks.action,
}));
import { DeskThemePicker } from "../../src/app/owner/(desk)/setup/desk-theme-picker";
let serverTheme: DeskThemeId, root: Root, container: HTMLDivElement;
function Desk() {
  const [current, setCurrent] = useState<DeskThemeId>("mono");
  mocks.refresh.mockImplementation(() => setCurrent(serverTheme));
  return createElement(
    "div",
    { "data-desk-theme": current, style: deskThemeStyle(current) },
    createElement(DeskThemePicker, { current }),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverTheme = "mono";
  mocks.action.mockImplementation(async (input: { theme: DeskThemeId }) => {
    serverTheme = input.theme;
    return { data: input };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Desk)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function pick() {
  await act(async () =>
    container.querySelectorAll<HTMLElement>('[role="radio"]')[2]!.click(),
  );
}
it("keeps the previous choice when saving fails", async () => {
  mocks.action.mockResolvedValue({ serverError: "Connection failed" });
  await pick();
  expect(
    container
      .querySelectorAll<HTMLElement>('[role="radio"]')[0]!
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(container.textContent).toContain("not saved");
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("shows each actual desk palette before the owner selects it", () => {
  const cards = [...container.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(cards).toHaveLength(4);
  for (const card of cards)
    expect(card.querySelectorAll('[style*="background-color"]')).toHaveLength(
      3,
    );
});
