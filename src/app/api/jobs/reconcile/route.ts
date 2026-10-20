import { getServerConfig } from "@/server/env";
import { secretsMatch } from "@/server/crypto";
import { runDueWork } from "@/server/jobs/run";

/** Platform ceiling; recovery stops admitting work earlier and awaits durable cleanup. */
export const maxDuration = 120;

/**
 * Authenticated recovery trigger for host schedulers. Requires
 * `Authorization: Bearer <JOBS_SECRET>`. POST is the normal trigger; GET with
 * the same header is accepted only because Vercel Cron can send GET requests.
 */
async function handle(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !secretsMatch(presented, getServerConfig().jobsSecret)) {
    return Response.json({ message: "Not authorized" }, { status: 401 });
  }
  const summary = await runDueWork("jobs_route", { signal: request.signal });
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}

export const POST = handle;
export const GET = handle;
