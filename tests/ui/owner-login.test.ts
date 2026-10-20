/** Production owner sign-in never exposes server-maintenance commands. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ mode: "sandbox" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth/owner", () => ({ readOwner: async () => null }));
vi.mock("@/server/domain/seller", () => ({
  getSeller: async () => ({ displayName: "Sample shop" }),
}));
vi.mock("@/server/env", async (original) => ({
  ...(await original<typeof import("@/server/env")>()),
  getServerConfig: () => ({ mode: state.mode }),
}));
vi.mock("../../src/app/owner/login/login-form", () => ({
  LoginForm: () => createElement("form", null, "Sign in"),
}));
import OwnerLoginPage from "../../src/app/owner/login/page";
afterEach(() => vi.unstubAllEnvs());
it.each(["sandbox", "fixture"])(
  "keeps operator commands out of a production %s login",
  async (mode) => {
    state.mode = mode;
    vi.stubEnv("NODE_ENV", "production");
    const html = renderToStaticMarkup(await OwnerLoginPage());
    expect(html).toContain("Sign in to your desk");
    expect(html).not.toContain("pnpm");
    expect(html).not.toContain("on the server");
  },
);
it("keeps maintenance instructions available only in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(renderToStaticMarkup(await OwnerLoginPage())).toContain(
    "Developer setup",
  );
});
