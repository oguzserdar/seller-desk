/**
 * @fileoverview The AI connector end to end on a real D1 runtime: an AI app registers, asks for
 * access, the owner signs in and allows it, the app trades the code for a token and reads the desk
 * over MCP; removing the app stops its next call.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { POST as mcp } from "@/app/api/mcp/route";
import { connectorResumeUrl } from "@/lib/connector-resume";
import { getAuth } from "@/server/auth/auth";
import { bootstrapOwner } from "@/server/auth/bootstrap";
import { allowedApps, removeApp } from "@/server/connector/access";
import { answerConsent } from "@/server/connector/consent";
import { discoveryRoute } from "@/server/connector/discovery";
import { withD1Database } from "@/server/request-scope";
import { newD1TestDatabase } from "../support/d1";

const APP = "http://localhost:4310";
const RESOURCE = `${APP}/api/mcp`;
const REDIRECT = "http://127.0.0.1:33418/callback";
const EMAIL = "owner@example.test";
const PASSWORD = "connector-test-password";

let local: Awaited<ReturnType<typeof newD1TestDatabase>>;
let userId = "";
beforeEach(async () => {
  local = await newD1TestDatabase();
  const created = await inScope(() => bootstrapOwner({ email: EMAIL, password: PASSWORD, displayName: "Sample shop", country: "US", currency: "USD" }));
  if (created.outcome !== "created") throw new Error("Owner was not created");
  userId = created.userId;
});
afterEach(async () => local?.close());

const inScope = <T>(work: () => Promise<T>) => withD1Database(local.db, work);
const auth = (request: Request) => inScope(() => getAuth().handler(request));

async function pkce() {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

const rpc = (token: string | null, method: string, params: object = {}) =>
  inScope(() => mcp(new Request(RESOURCE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })));

async function rpcResult(response: Response) {
  const body = await response.text();
  const json = body.startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))!.slice(6);
  return JSON.parse(json) as { result?: { tools?: { name: string }[]; content?: { text: string }[] }; error?: unknown };
}

/** Runs the whole connection the way Claude Code would, and returns its access token and client id. */
async function connect() {
  const registered = await auth(new Request(`${APP}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  }));
  expect(registered.status).toBe(201);
  const client = (await registered.json()) as { client_id: string; application_type: string };
  expect(client.application_type).toBe("native");

  const { verifier, challenge } = await pkce();
  const request = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, scope: "openid offline_access", state: "s1", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE });
  const toLogin = await auth(new Request(`${APP}/api/auth/oauth2/authorize?${request}`, { redirect: "manual" }));
  const login = new URL(toLogin.headers.get("location")!, APP);
  expect(login.pathname).toBe("/owner/login");

  const signedIn = await inScope(() => getAuth().api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, asResponse: true }));
  const cookie = signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const toConsent = await auth(new Request(new URL(connectorResumeUrl(login.search)!, APP), { headers: { cookie }, redirect: "manual" }));
  const consent = new URL(toConsent.headers.get("location")!, APP);
  expect(consent.pathname).toBe("/owner/connect");

  const back = new URL(await inScope(() => answerConsent(new Headers({ cookie }), true, consent.search.slice(1))));
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("s1");

  const tokens = await auth(new Request(`${APP}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
  }));
  expect(tokens.status).toBe(200);
  return { token: ((await tokens.json()) as { access_token: string }).access_token, clientId: client.client_id };
}

it("tells an unsigned AI app where to sign in", async () => {
  const response = await rpc(null, "tools/list");
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  const metadata = await inScope(() => discoveryRoute(new Request(`${APP}/.well-known/oauth-protected-resource/api/mcp`)));
  expect(((await metadata.json()) as { resource: string }).resource).toBe(RESOURCE);
});

it("lets an allowed AI app read the desk with read-only tools, and stops it once removed", async () => {
  const { token } = await connect();
  const tools = await rpcResult(await rpc(token, "tools/list"));
  expect(tools.result!.tools!.map((t) => t.name).sort()).toEqual(["list_conversations", "list_offers", "list_orders", "list_waiting", "read_conversation"]);
  const waiting = await rpcResult(await rpc(token, "tools/call", { name: "list_waiting", arguments: {} }));
  expect(waiting.result!.content![0]!.text).toContain("No buyer is waiting on a question.");

  const [app] = await inScope(() => allowedApps(userId));
  expect(app!.name).toBe("Claude Code");
  expect(await inScope(() => removeApp(userId, app!.consentId))).toBe(true);
  expect((await rpc(token, "tools/list")).status).toBe(401);
});
