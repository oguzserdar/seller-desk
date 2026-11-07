/** Agent Skills discovery index for this installation: lists the Seller Desk skill and its digest. */
import { skillIndex } from "@/lib/agent-skill";
import { connectorResource } from "@/server/auth/connector";
import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await skillIndex(connectorResource(getServerConfig().appUrl)), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
