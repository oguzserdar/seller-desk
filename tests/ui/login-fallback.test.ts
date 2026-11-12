// @vitest-environment happy-dom
/**
 * @fileoverview Owner sign-in: never a GET with credentials, and a correct password signs in through
 * Better Auth's own endpoint followed by a full page load (no Server Action sets the cookie).
 * @module tests/ui/login-fallback
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
const signIn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: signIn } } }));
import { LoginForm } from "../../src/app/owner/login/login-form";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("keeps credentials out of a URL and waits for the client submit handler", () => {
  const html = renderToStaticMarkup(createElement(LoginForm));
  expect(html).toContain('method="post"');
  expect(html).toMatch(/<button[^>]*disabled=""/);
});

async function submitWith(status: number) {
  signIn.mockReset();
  signIn.mockResolvedValue(status === 200 ? { data: {}, error: null } : { data: null, error: { status } });
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, search: "", assign });
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => { createRoot(container).render(createElement(LoginForm)); });
  (container.querySelector("#email") as HTMLInputElement).value = "owner@example.test";
  (container.querySelector("#password") as HTMLInputElement).value = "correct horse battery";
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
  return { assign, container };
}

it("a correct password goes to Better Auth's sign-in and then loads the desk", async () => {
  const { assign, container } = await submitWith(200);
  expect(signIn).toHaveBeenCalledWith({ email: "owner@example.test", password: "correct horse battery" });
  expect(assign).toHaveBeenCalledWith("/owner/orders");
  expect(container.textContent).not.toContain("not correct");
  expect(container.textContent).not.toContain("Something went wrong");
});

it("a wrong password says so and stays on the page", async () => {
  const { assign, container } = await submitWith(401);
  expect(assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("That email or password is not correct.");
});

it("a dropped connection shows an error and frees the button instead of spinning forever", async () => {
  await submitWith(200);
  document.body.innerHTML = "";
  signIn.mockReset();
  signIn.mockRejectedValue(new TypeError("Failed to fetch"));
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => { createRoot(container).render(createElement(LoginForm)); });
  (container.querySelector("#email") as HTMLInputElement).value = "owner@example.test";
  (container.querySelector("#password") as HTMLInputElement).value = "correct horse battery";
  await act(async () => { container.querySelector("form")!.requestSubmit(); });
  expect(container.textContent).toContain("could not be reached");
  expect((container.querySelector("button[type='submit']") as HTMLButtonElement).disabled).toBe(false);
});
