import { type NextRequest, NextResponse } from "next/server";
import { allowedFrameOrigins, FRAMEABLE_PATHS, frameAncestors } from "@/server/http/frame-policy";

/**
 * Security headers for every response. Only the buyer surfaces (/widget, /buy)
 * may be framed, and only by the owner's exact allowed origins; owner pages and
 * everything else refuse framing.
 */
export async function proxy(request: NextRequest) {
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
