import { allowedFrameOrigins } from "@/server/http/frame-policy";

/**
 * Lets widget.js skip drawing the launcher on sites the owner has not allowed,
 * instead of opening a frame the browser will refuse. The answer is only about
 * the caller's own Origin header (set by the browser), so any site may ask.
 * frame-ancestors on /widget still enforces the rule either way.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowed = origin !== null && (await allowedFrameOrigins()).includes(origin);
  return Response.json({ allowed }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", Vary: "Origin" } });
}
