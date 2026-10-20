import { z } from "zod";
import { startBuyerSession } from "@/server/domain/buyer-session";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ entry: z.enum(["page", "widget"]) }).strict();

/** Starts a buyer chat session and returns its capability once. Only the hash is stored. */
export const POST = route(async (request, requestId) => {
  await requireUsage("buyer_session_client", clientKey(request.headers), 600, 30, "Too many new chats from this connection.");
  const { entry } = Body.parse(await readJson(request));
  const issued = await startBuyerSession(entry);
  return ok(requestId, { token: issued.token, expiresAt: issued.expiresAt }, "Chat started.", [], 201);
});
