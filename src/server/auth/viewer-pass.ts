/**
 * The pass a visitor gets when they choose to look around a public demo's desk. It is a signed
 * expiry time in a cookie, with no account behind it: it lets pages be read and nothing be changed.
 * Only an installation marked PUBLIC_DEMO issues or accepts it.
 */
import { getServerConfig } from "@/server/env";

export const VIEWER_COOKIE = "seller-desk.viewer";
/** Long enough to look around; short enough that an old link is no standing key. */
export const VIEWER_SECONDS = 2 * 60 * 60;

async function sign(expires: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(getServerConfig().authSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`seller-desk/viewer/v1/${expires}`));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new pass value, valid from now for VIEWER_SECONDS. */
export async function issueViewerPass(now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + VIEWER_SECONDS;
  return `${expires}.${await sign(expires)}`;
}

/**
 * Whether a request carries a pass this installation issued and that has not run out.
 *
 * @param cookieHeader - The request's Cookie header
 * @returns True only on a public demo with a valid, unexpired pass
 */
export async function hasViewerPass(cookieHeader: string | null, now = Date.now()): Promise<boolean> {
  if (!cookieHeader || !getServerConfig().publicDemo) return false;
  const value = cookieHeader.split(/;\s*/).find((part) => part.startsWith(`${VIEWER_COOKIE}=`))?.slice(VIEWER_COOKIE.length + 1);
  const [expiresText, mac] = value?.split(".") ?? [];
  const expires = Number(expiresText);
  if (!mac || !Number.isInteger(expires) || expires * 1000 <= now) return false;
  const expected = await sign(expires);
  if (expected.length !== mac.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ mac.charCodeAt(index);
  return difference === 0;
}
