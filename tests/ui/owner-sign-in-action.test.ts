/**
 * @fileoverview Owner sign-in returns success and never navigates from inside the Server Action.
 * @module tests/ui/owner-sign-in-action
 *
 * Regression: a redirect() thrown inside the action surfaced on vinext as an error ("wrong
 * password") after the session cookie was already set. The form navigates instead.
 */
import { expect, it, vi } from "vitest";
const redirect = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_REDIRECT"); }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ delete: vi.fn(), has: () => false }) }));
vi.mock("@/server/domain/usage", () => ({ clientKey: () => "test", requireUsage: async () => undefined }));
vi.mock("@/server/domain/seller", () => ({ findSellerForUser: async () => ({ sellerId: "s1" }) }));
vi.mock("@/server/auth/auth", () => ({
  getAuth: () => ({ api: { signInEmail: async () => ({ user: { id: "u1" } }), signOut: async () => undefined } }),
}));
import { signInOwner } from "../../src/app/owner/login/actions";

it("a correct password comes back as success, with no redirect thrown inside the action", async () => {
  const result = await signInOwner({ email: "owner@example.test", password: "correct horse" });
  expect(result?.serverError).toBeUndefined();
  expect(result?.data).toEqual({ ok: true });
  expect(redirect).not.toHaveBeenCalled();
});
