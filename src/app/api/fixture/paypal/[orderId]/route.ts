import { decideDemoPayment } from "@/server/domain/fixture-payment";
import { getServerConfig } from "@/server/env";
import { notFound } from "next/navigation";

/**
 * Fixture stand-in for the payer's choice on PayPal's approval page.
 * Exists only in APP_MODE=fixture; returns 404 in sandbox mode.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  if (getServerConfig().mode !== "fixture") notFound();
  const { orderId } = await params;
  const form = await request.formData();
  const decision = form.get("decision") === "approve" ? "approve" : "cancel";
  const row = await decideDemoPayment(orderId, decision);
  if (!row) return new Response("Not found", { status: 404 });
  const target =
    decision === "approve" && row.status === "APPROVED"
      ? `${row.returnUrl}&token=${encodeURIComponent(row.id)}&PayerID=FIXTUREPAYER01`
      : `${row.cancelUrl}&token=${encodeURIComponent(row.id)}`;
  return Response.redirect(target, 303);
}
