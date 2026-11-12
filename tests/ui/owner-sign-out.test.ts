// @vitest-environment happy-dom
/**
 * @fileoverview Owner sign-out: Better Auth's client ends the session, the demo pass route removes the
 * pass, and the page leaves for sign-in; no Server Action, so no false "Could not sign out".
 * @module tests/ui/owner-sign-out
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { SidebarProvider } from "@/components/shadcn/sidebar";
import { AccountMenu } from "../../src/app/owner/(desk)/account-menu";
import { DELETE } from "../../src/app/owner/demo/route";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function clickSignOut(sessionError: unknown, passStatus: number) {
  signOut.mockReset();
  signOut.mockResolvedValue({ data: sessionError ? null : { success: true }, error: sessionError });
  const fetchMock = vi.fn(async () => new Response(null, { status: passStatus }));
  vi.stubGlobal("fetch", fetchMock);
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    createRoot(container).render(createElement(SidebarProvider, null, createElement(AccountMenu, { name: "Oguz", email: "o@example.test" })));
  });
  const trigger = container.querySelector("button[aria-label^='Account menu']") as HTMLButtonElement;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  const item = [...document.querySelectorAll("[role='menuitem']")].find((e) => /sign out/i.test(e.textContent ?? "")) as HTMLElement;
  await act(async () => { item.click(); });
  return { fetchMock, assign };
}

it("signs out through Better Auth, removes the demo pass, and opens the sign-in page", async () => {
  const { fetchMock, assign } = await clickSignOut(null, 204);
  expect(signOut).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith("/owner/demo", { method: "DELETE" });
  expect(assign).toHaveBeenCalledWith("/owner/login");
  expect(document.body.textContent).not.toContain("Could not sign out");
});

it("says so only when signing out really failed", async () => {
  const { assign } = await clickSignOut({ status: 500 }, 204);
  expect(assign).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Could not sign out. Try again.");
});

it("the demo pass route clears the pass cookie", async () => {
  const response = await DELETE();
  expect(response.status).toBe(204);
  expect(response.headers.get("set-cookie")).toMatch(/seller-desk\.viewer=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
});

it("lets a demo visitor (no Better Auth session) leave: a missing session is not a failed sign-out", async () => {
  const { assign } = await clickSignOut({ status: 400, code: "FAILED_TO_GET_SESSION" }, 204);
  expect(assign).toHaveBeenCalledWith("/owner/login");
  expect(document.body.textContent).not.toContain("Could not sign out");
});
