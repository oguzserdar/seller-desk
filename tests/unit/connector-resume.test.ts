/** @fileoverview After sign-in, an AI app's access request resumes at the authorize endpoint with its original parameters only. */
import { expect, it } from "vitest";
import { connectorResumeUrl, pageQuery } from "@/lib/connector-resume";

const SIGNED = "response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcb&scope=openid&state=s1&code_challenge=x&code_challenge_method=S256&resource=https%3A%2F%2Fshop.test%2Fapi%2Fmcp&prompt=login&ba_iat=1&ba_sp=client_id&exp=9&sig=zz";

it("drops the signature and Better Auth's markers, keeping the app's own request", () => {
  const url = new URL(connectorResumeUrl(`?${SIGNED}`)!, "https://shop.test");
  expect(url.pathname).toBe("/api/auth/oauth2/authorize");
  expect([...url.searchParams.keys()]).toEqual(["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource"]);
  expect(url.searchParams.get("redirect_uri")).toBe("https://chatgpt.com/cb");
});

it("keeps a prompt other than login, since only a fresh login has already happened", () => {
  const url = new URL(connectorResumeUrl(SIGNED.replace("prompt=login", "prompt=consent"))!, "https://shop.test");
  expect(url.searchParams.get("prompt")).toBe("consent");
});

it("returns null for an ordinary login page with no signed request", () => {
  expect(connectorResumeUrl("")).toBeNull();
  expect(connectorResumeUrl("?client_id=abc")).toBeNull();
});

it("rebuilds repeated query keys from page search params in order", () => {
  expect(pageQuery({ a: "1", b: ["2", "3"], c: undefined })).toBe("a=1&b=2&b=3");
});
