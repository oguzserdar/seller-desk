/** The Seller Desk agent skill, with this installation's connector address in it. */
import { skillMarkdown } from "@/lib/agent-skill";
import { connectorResource } from "@/server/auth/connector";
import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(skillMarkdown(connectorResource(getServerConfig().appUrl)), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
