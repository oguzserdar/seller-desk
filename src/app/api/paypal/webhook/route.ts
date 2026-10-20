import { ingestWebhook } from "@/server/payments/webhooks";

/**
 * PayPal webhook receiver. Reads the raw body once (verification needs the
 * exact bytes), answers 200 only after the verified event is stored, and
 * answers non-2xx otherwise so PayPal retries.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  try {
    const result = await ingestWebhook(request.headers, rawBody);
    return Response.json({ message: result.message }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("webhook ingest failed", error);
    return Response.json({ message: "Not stored; retry later" }, { status: 500 });
  }
}
