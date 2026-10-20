import { z } from "zod";
import { approvedDestination } from "@/server/domain/shop-guide";
import { getSeller } from "@/server/domain/seller";
import { DomainError, notFound } from "@/server/domain/errors";
import { route } from "@/server/http/respond";

/** Public link to public approved knowledge. No buyer session or personal data crosses to the destination. */
export const GET = route(async (request, _requestId, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const revision = z.coerce.number().int().positive().parse(new URL(request.url).searchParams.get("revision"));
  const seller = await getSeller();
  if (!seller) throw notFound("shop");
  try {
    const entry = await approvedDestination(seller.id, id, revision);
    return new Response(null, { status: 302, headers: { Location: entry.actionUrl!, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "not_found") throw error;
    return new Response(null, { status: 303, headers: { Location: "/shop-step/unavailable", "Cache-Control": "no-store" } });
  }
});
