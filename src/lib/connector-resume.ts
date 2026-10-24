/**
 * When an AI app asks for access and the owner is not signed in, Better Auth sends the browser to
 * the owner login page with the app's authorization request in the query, signed. After sign-in the
 * page resumes that request at the authorize endpoint, which checks it again and continues to the
 * consent page. Browser-safe: no server imports.
 */

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

/**
 * Rebuilds a page's query string from Next.js `searchParams`, keeping repeated keys in order.
 *
 * @param params - The awaited `searchParams` of a page
 * @returns The query string without a leading "?"
 */
export function pageQuery(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  return query.toString();
}

/**
 * The authorize URL to resume after sign-in, or null when the page was not opened by an AI app.
 *
 * @param search - The login page's query string, with or without the leading "?"
 * @returns A same-origin path to the authorize endpoint carrying the app's original request
 */
export function connectorResumeUrl(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get("client_id") || !params.has("sig")) return null;
  const request = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === "sig" || key === "exp" || key.startsWith("ba_")) continue;
    // A request that asked for a fresh login has had one; sending it again would loop back here.
    if (key === "prompt" && value === "login") continue;
    request.append(key, value);
  }
  return `${AUTHORIZE_PATH}?${request}`;
}
