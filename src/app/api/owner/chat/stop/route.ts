import { stopOwnerTurn } from "@/server/ai/owner-conversation";
import { requireOwner } from "@/server/auth/owner";
import { ok, route } from "@/server/http/respond";

/** Stops the owner's running desk answer so the desk chat is free again at once. */
export const POST = route(async (request, requestId) => {
  const { owner } = await requireOwner(request.headers);
  await stopOwnerTurn(owner);
  return ok(requestId, { stopped: true });
});
