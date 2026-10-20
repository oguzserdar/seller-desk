import { z } from "zod";
import { exchangeHandoff } from "@/server/domain/buyer-session";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ code: z.string().min(20).max(128) }).strict();

/** Trades a one-time handoff code (from the URL fragment) for this tab's own buyer capability. */
export const POST = route(async (request, requestId) => {
  await requireUsage("buyer_handoff_client", clientKey(request.headers), 600, 60, "Too many checkout links opened from this connection.");
  const { code } = Body.parse(await readJson(request));
  const issued = await exchangeHandoff(code);
  return ok(requestId, { token: issued.token, expiresAt: issued.expiresAt, quoteId: issued.quoteId }, "Checkout opened.");
});
