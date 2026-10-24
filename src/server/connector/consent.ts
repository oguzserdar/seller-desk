/**
 * Sends the owner's Allow or Deny for an AI app to Better Auth. The consent step continues the
 * authorization request and needs the incoming HTTP request, which a direct `auth.api` call does not
 * carry, so the answer goes through Better Auth's handler as a same-origin request with the owner's
 * session cookie.
 */
import { getAuth } from "@/server/auth/auth";
import { getServerConfig } from "@/server/env";

/**
 * Records the owner's answer and returns where the browser goes next.
 *
 * @param requestHeaders - The owner's request headers; only the cookie is forwarded
 * @param accept - True to allow the AI app, false to deny it
 * @param oauthQuery - The signed request query the consent page was opened with
 * @returns The AI app's redirect address, carrying a code or an access_denied error
 * @throws Error when Better Auth refuses the answer (for example an expired request)
 */
export async function answerConsent(requestHeaders: Headers, accept: boolean, oauthQuery: string): Promise<string> {
  const { authUrl } = getServerConfig();
  const origin = new URL(authUrl).origin;
  const response = await getAuth().handler(new Request(`${origin}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin, cookie: requestHeaders.get("cookie") ?? "" },
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  }));
  const body = (await response.json().catch(() => null)) as { redirect_uri?: string; url?: string } | null;
  const next = body?.redirect_uri ?? body?.url;
  if (!response.ok || !next) throw new Error("This request from the AI app has expired. Start the connection again from the app.");
  return next;
}
