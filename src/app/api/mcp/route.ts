/**
 * The Seller Desk connector for the owner's own ChatGPT, Claude, Claude Code or Codex (MCP over
 * streamable HTTP, stateless). Better Auth's protected-resource handler checks the bearer token
 * (signature, issuer, audience = this endpoint, expiry) and answers 401 with the RFC 9728 challenge,
 * which makes the AI app start sign-in. The tools are read-only; see src/server/connector/tools.ts.
 *
 * The signing keys are read from this installation's own Better Auth rather than fetched from its
 * /jwks URL: a Worker requesting its own hostname does not reach itself, and there is no reason to
 * make a network call for keys held in the same database.
 */
import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { APIError } from "better-auth/api";
import { getAuth } from "@/server/auth/auth";
import { connectorResource } from "@/server/auth/connector";
import { stillAllowed } from "@/server/connector/access";
import { buildConnectorServer } from "@/server/connector/tools";
import { findSellerForUser } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";

/** The same challenge an unsigned call gets, so a removed app sends the owner through sign-in again. */
function signInAgain(resource: string, message: string): Response {
  const challenge = createResourceServerChallenge(new APIError("UNAUTHORIZED", { message }), resource);
  const headers = new Headers(challenge?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), { status: 401, headers });
}

/** Stable, so Better Auth's key cache keeps one entry; reads the keys of the current request's database. */
const ownSigningKeys = async () => (await getAuth().api.getJwks()) as never;

async function handle(request: Request): Promise<Response> {
  const resource = connectorResource(getServerConfig().appUrl);
  const { baseURL } = await getAuth().$context;
  return createMcpProtectedRequestHandler(
    // Better Auth's verifier accepts a key-set function here; the MCP option type still names only a URL.
    { issuer: baseURL, audience: resource, jwksUrl: ownSigningKeys as unknown as string },
    async (req, claims) => {
      const userId = typeof claims.sub === "string" ? claims.sub : "";
      const clientId = typeof claims.azp === "string" ? claims.azp : "";
      // Tokens verify by signature alone; this makes Remove in Setup take effect on the next call.
      if (!userId || !clientId || !(await stillAllowed(userId, clientId)))
        return signInAgain(resource, "Access to Seller Desk was removed. Connect it again to continue.");
      const seller = await findSellerForUser(userId);
      if (!seller) return signInAgain(resource, "This account does not own the shop. Connect with the owner account.");
      const owner = { kind: "owner" as const, userId, sellerId: seller.id };
      // Older (2025) clients are served statelessly too, so every AI app works whichever protocol revision it speaks.
      return createMcpHandler(() => buildConnectorServer(owner), { legacy: "stateless" }).fetch(req);
    },
  )(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
