import { NextResponse, type NextRequest } from "next/server";
import { getSeller } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";
import { VIEWER_COOKIE, VIEWER_SECONDS, issueViewerPass } from "@/server/auth/viewer-pass";

export const dynamic = "force-dynamic";

/**
 * "Look around the demo desk": gives the visitor a read-only pass and opens the desk. It exists only
 * on an installation marked PUBLIC_DEMO; anywhere else the address is not found.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const config = getServerConfig();
  if (!config.publicDemo || !(await getSeller())) return new Response("Not found", { status: 404 });
  const response = NextResponse.redirect(new URL("/owner/orders", config.appUrl), 303);
  response.cookies.set(VIEWER_COOKIE, await issueViewerPass(), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.appUrl.startsWith("https://"),
    path: "/",
    maxAge: VIEWER_SECONDS,
  });
  return response;
}
