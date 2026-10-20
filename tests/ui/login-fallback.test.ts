/** @fileoverview Password sign-in cannot fall back to a GET submission before hydration. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next-safe-action/hooks", () => ({ useAction: () => ({ execute: vi.fn(), isPending: false, result: {} }) }));
vi.mock("../../src/app/owner/login/actions", () => ({ signInOwner: vi.fn() }));
import { LoginForm } from "../../src/app/owner/login/login-form";
it("keeps credentials out of a URL and waits for the client submit handler", () => {
  const html = renderToStaticMarkup(createElement(LoginForm));
  expect(html).toContain('method="post"');
  expect(html).toMatch(/<button[^>]*disabled=""/);
});
