// @vitest-environment happy-dom
/**
 * @fileoverview A customer can close the shop tab and come back to the same chat.
 * @module tests/ui/buyer-token-persist
 *
 * The handoff card promises "The reply lands in this chat, so you can close the page and come back."
 * The chat capability lived in sessionStorage, which the browser clears when the tab closes, so a
 * returning customer found an empty chat. These tests reload the module with a fresh tab:
 * - a saved chat survives the tab closing (sessionStorage cleared, module memory gone)
 * - ending the chat forgets it for good
 */
import { afterEach, expect, it, vi } from "vitest";

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function freshTab() {
  // A closed tab loses sessionStorage and in-memory state; a new tab loads the module again.
  window.sessionStorage.clear();
  vi.resetModules();
  return import("../../src/lib/buyer-client");
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

it("keeps the customer's chat after the tab is closed and opened again", async () => {
  const first = await import("../../src/lib/buyer-client");
  first.saveToken({ token: "chat-token", expiresAt: future() });
  const reopened = await freshTab();
  expect(reopened.readToken()?.token).toBe("chat-token");
});

it("forgets the chat for good when the customer ends it", async () => {
  const first = await import("../../src/lib/buyer-client");
  first.saveToken({ token: "chat-token", expiresAt: future() });
  first.clearToken();
  const reopened = await freshTab();
  expect(reopened.readToken()).toBeNull();
});

it("keeps a chat saved by the previous version (sessionStorage) and moves it over", async () => {
  window.sessionStorage.setItem("seller-desk.buyer", JSON.stringify({ token: "old-tab-token", expiresAt: future() }));
  vi.resetModules();
  const page = await import("../../src/lib/buyer-client");
  expect(page.readToken()?.token).toBe("old-tab-token");
  expect(JSON.parse(window.localStorage.getItem("seller-desk.buyer") ?? "{}").token).toBe("old-tab-token");
});
