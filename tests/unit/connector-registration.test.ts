/** @fileoverview Desktop and command-line AI apps that omit application_type still register, as native apps (RFC 8252). */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { inferNativeClient } from "@/server/auth/connector";

it("registers an app whose redirects are all http loopback addresses as native", () => {
  for (const uri of ["http://localhost:8787/callback", "http://127.0.0.1:33418/callback", "http://[::1]:9000/cb"])
    expect(inferNativeClient({ redirect_uris: [uri] })).toEqual({ redirect_uris: [uri], application_type: "native" });
});

it("leaves web apps, mixed redirects and an explicit type alone", () => {
  for (const body of [
    { redirect_uris: ["https://chatgpt.com/connector/oauth/callback"] },
    { redirect_uris: ["http://localhost:8787/cb", "https://claude.ai/api/mcp/auth_callback"] },
    { redirect_uris: ["http://localhost.evil.test/cb"] },
    { redirect_uris: ["http://127.0.0.1:1/cb"], application_type: "web" },
    { redirect_uris: [] },
    null,
  ])
    expect(inferNativeClient(body)).toBe(body);
});

it("is still needed: the installed Better Auth has no built-in way to infer the type", () => {
  const dist = path.dirname(require.resolve("@better-auth/oauth-provider"));
  const source = readdirSync(dist).filter((f) => f.endsWith(".mjs")).map((f) => readFileSync(path.join(dist, f), "utf8")).join("\n");
  // When this fails, set mcp({ clientRegistrationDefaultApplicationType: "infer" }) and delete inferNativeClient.
  expect(source).not.toContain("clientRegistrationDefaultApplicationType");
});
