import { type NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/server/env";
import { allowedFrameOrigins, FRAMEABLE_PATHS, frameAncestors } from "@/server/http/frame-policy";

/**
 * A page opened on the Worker's own workers.dev address, when the shop lives on its own domain,
 * moves to that domain. Sign-in and checkout only trust the shop's address, so an old link would
 * otherwise load and then fail. Only page loads move; API calls and webhooks are left alone.
 */
function canonicalAddress(request: NextRequest): URL | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (!host.endsWith(".workers.dev") || request.nextUrl.pathname.startsWith("/api/")) return null;
  let home: URL;
  try {
    home = new URL(getServerConfig().appUrl);
  } catch {
    return null;
  }
  if (home.host === host) return null;
  return new URL(request.nextUrl.pathname + request.nextUrl.search, home);
}

/**
 * Security headers for every response. Only the buyer surfaces (/widget, /buy)
 * may be framed, and only by the owner's exact allowed origins; owner pages and
 * everything else refuse framing.
 */
export async function proxy(request: NextRequest) {
  const moved = canonicalAddress(request);
  if (moved) return NextResponse.redirect(moved, 308);
  const path = request.nextUrl.pathname;
  const frameable = FRAMEABLE_PATHS.has(path);
  const origins = frameable ? await allowedFrameOrigins() : [];
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${frameAncestors(path, origins)}; base-uri 'self'; object-src 'none'`,
  );
  if (!frameable) response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
