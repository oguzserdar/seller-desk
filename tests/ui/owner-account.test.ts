/** @fileoverview Keeps account details behind one owner menu, without an exposed email/logout footer. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/owner/orders",
}));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ execute: vi.fn(), isPending: false, result: {} }),
}));
vi.mock("@/server/auth/owner", () => ({
  readOwner: async () => ({
    name: "Oguz Serdar",
    email: "oguz@averylongcompany.example",
    owner: {},
    seller: { displayName: "Sample shop" },
  }),
}));
vi.mock("@/server/domain/desk", () => ({
  queryDesk: async () => ({ rows: [] }),
}));
vi.mock("@/server/domain/seller-questions", () => ({
  openQuestions: async () => [],
}));
vi.mock("../../src/app/owner/login/actions", () => ({ signOutOwner: vi.fn() }));
import OwnerDeskLayout from "../../src/app/owner/(desk)/layout";
it("shows the person's account trigger and keeps the full email and logout inside its menu", async () => {
  const html = renderToStaticMarkup(
    await OwnerDeskLayout({
      children: createElement("p", null, "Desk content"),
    }),
  );
  expect(html).toContain('aria-label="Account menu, Oguz"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).not.toContain("oguz@averylongcompany.example");
  expect(html).not.toContain("Sign out");
});
