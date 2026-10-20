import { resolveBuyer } from "@/server/domain/buyer-session";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { bearerToken } from "./respond";

/** Pre-auth client limit, then the buyer's own capability. */
export async function buyerFrom(request: Request): Promise<BuyerPrincipal> {
  await requireUsage("buyer_api_client", clientKey(request.headers), 600, 900, "Too many requests from this connection.");
  return resolveBuyer(bearerToken(request));
}

/** Same, but returns null instead of failing when no capability is presented. */
export async function optionalBuyer(request: Request): Promise<BuyerPrincipal | null> {
  if (!bearerToken(request)) return null;
  return buyerFrom(request);
}
