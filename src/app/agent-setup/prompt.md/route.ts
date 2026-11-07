/** Setup instructions a coding agent fetches to connect itself to this installation. */
import { setupPrompt } from "@/lib/agent-setup";
import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(setupPrompt(getServerConfig().appUrl), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
