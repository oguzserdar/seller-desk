/**
 * Seller Desk as the OAuth authorization server for the owner's own AI apps (ChatGPT, Claude,
 * Claude Code, Codex). Better Auth's MCP plugin issues short-lived access tokens bound to the
 * `/api/mcp` endpoint after the owner signs in and approves the app on the consent page.
 *
 * Clients register dynamically (RFC 7591). Client ID Metadata Documents are not offered: Better
 * Auth's safe fetcher for them needs Node's DNS pinning, which the Workers host does not have,
 * and every target client also supports dynamic registration. See docs/ai-connector.md.
 */
import { mcp } from "@better-auth/mcp";
import { createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";

/** The connector endpoint the AI apps call; access tokens carry it as their audience. */
export const connectorResource = (appUrl: string) => `${appUrl.replace(/\/$/, "")}/api/mcp`;

/** Where an AI app is sent to sign the owner in and to ask for their approval. */
export const CONNECTOR_LOGIN_PAGE = "/owner/login";
export const CONNECTOR_CONSENT_PAGE = "/owner/connect";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Registration body for desktop and command-line AI apps (Claude Code, Codex, Cursor) that leave out
 * `application_type`. They redirect to a loopback address, which Better Auth 1.7.7 accepts only from
 * native clients, while it defaults an unstated type to web. A request whose redirects are all
 * http loopback addresses is a native app by RFC 8252, so it is registered as one. Later Better Auth
 * releases do this with `clientRegistrationDefaultApplicationType: "infer"`; a test fails once the
 * installed version offers it, so this can be removed then.
 *
 * @param body - The dynamic client registration request body
 * @returns The body to register, unchanged unless the type was missing and every redirect is loopback
 */
export function inferNativeClient(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const request = body as { application_type?: unknown; redirect_uris?: unknown };
  if (request.application_type !== undefined || !Array.isArray(request.redirect_uris) || !request.redirect_uris.length) return body;
  const loopback = request.redirect_uris.every((uri) => {
    if (typeof uri !== "string" || !URL.canParse(uri)) return false;
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK.has(url.hostname);
  });
  return loopback ? { ...request, application_type: "native" } : body;
}

/** Applies {@link inferNativeClient} to dynamic client registrations only. */
export const connectorHooks = {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/oauth2/register") return;
    const body = inferNativeClient(ctx.body);
    if (body !== ctx.body) return { context: { body } };
  }),
};

/**
 * The Better Auth plugins that make Seller Desk an authorization server for its connector.
 *
 * @param appUrl - Public origin of this installation; the connector resource is derived from it
 * @returns Plugins to add to the Better Auth options (they also decide the OAuth tables)
 */
export function connectorPlugins(appUrl: string) {
  return [
    jwt(),
    mcp({
      loginPage: CONNECTOR_LOGIN_PAGE,
      consentPage: CONNECTOR_CONSENT_PAGE,
      resource: connectorResource(appUrl),
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // A token outlives a removed app by at most ten minutes; the endpoint also checks the consent on every call.
      accessTokenExpiresIn: 600,
    }),
  ];
}
