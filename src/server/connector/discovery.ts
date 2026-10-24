/**
 * OAuth discovery for the connector. AI apps look for it at the site root (/.well-known/...), but
 * Better Auth is mounted under /api/auth, so Next never routes those paths to it. Better Auth's
 * plugins match discovery requests by their full path, so passing the request through unchanged is
 * enough: the MCP plugin answers /.well-known/oauth-protected-resource[/api/mcp] and the provider
 * answers /.well-known/oauth-authorization-server[/api/auth]. Anything else is Better Auth's 404.
 */
import { getAuth } from "@/server/auth/auth";

/**
 * Route handler for both discovery documents.
 *
 * @param request - The incoming discovery request, forwarded as is
 * @returns Better Auth's discovery JSON, or its 404 for an unknown path
 */
export function discoveryRoute(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
