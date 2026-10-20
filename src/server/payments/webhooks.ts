import { getStorage } from "@/server/storage";
/**
 * PayPal webhook inbox. A notification is verified (PayPal postback in sandbox,
 * HMAC in fixture mode), stored once per (environment, event id), and then
 * processed by the same reconcile operation the buyer and the job use. The
 * event body itself never decides payment: reconcile reads PayPal again.
 */
import type { WebhookSummary } from "@/server/db/types";
import { getPayPal } from "@/server/paypal";
import { TransportUncertainError } from "@/server/paypal/types";
import { z } from "zod";
import { reconcilePayment } from "./engine";

const MAX_BODY_BYTES = 64_000;

const EventBody = z.looseObject({
  id: z.string().min(1).max(100),
  event_type: z.string().min(1).max(100),
  resource_type: z.string().max(100).optional(),
  resource: z
    .looseObject({
      id: z.string().max(100).optional(),
      status: z.string().max(60).optional(),
      supplementary_data: z
        .looseObject({
          related_ids: z
            .looseObject({ order_id: z.string().max(100).optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export type IngestResult = {
  status: number;
  message: string;
  eventId?: string;
  duplicate?: boolean;
};

/** Finds the PayPal order id an event refers to: orders carry it as resource.id, captures in related_ids. */
export function orderIdOfEvent(
  event: z.infer<typeof EventBody>,
): string | null {
  if (event.event_type.startsWith("CHECKOUT.ORDER."))
    return event.resource?.id ?? null;
  return event.resource?.supplementary_data?.related_ids?.order_id ?? null;
}

export async function ingestWebhook(
  headers: Headers,
  rawBody: string,
): Promise<IngestResult> {
  if (rawBody.length > MAX_BODY_BYTES)
    return { status: 413, message: "Too large" };
  const paypal = getPayPal();
  if (!paypal.ok) return { status: 503, message: "PayPal is not configured" };
  let verified: boolean;
  try {
    verified = await paypal.transport.verifyWebhook({ headers, rawBody });
  } catch (error) {
    // Verification service unreachable: refuse for now so PayPal retries later.
    if (error instanceof TransportUncertainError)
      return { status: 503, message: "Verification unavailable" };
    verified = false;
  }
  if (!verified) {
    await getStorage().audit.record({
      actor: "paypal",
      operation: "webhook.rejected",
      outcome: "denied",
      details: { bytes: rawBody.length },
    });
    return { status: 401, message: "Signature not verified" };
  }
  let event: z.infer<typeof EventBody>;
  try {
    event = EventBody.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, message: "Unreadable event" };
  }
  const summary: WebhookSummary = {
    eventType: event.event_type,
    resourceType: event.resource_type ?? null,
    resourceId: event.resource?.id ?? null,
    status: event.resource?.status ?? null,
  };
  const id = await getStorage().webhooks.receive({
    environment: paypal.transport.environment,
    providerEventId: event.id,
    eventType: event.event_type,
    providerOrderId: orderIdOfEvent(event),
    summary,
  });
  if (!id) return { status: 200, message: "Already received", duplicate: true };
  // Stored durably; processing failures are retried by the job runner.
  await processWebhookEvent(id).catch((error: unknown) =>
    console.error("webhook processing failed", error),
  );
  return { status: 200, message: "Received", eventId: id };
}

/** Applies one stored event through the ordinary reconcile path. Safe to repeat. */
export async function processWebhookEvent(
  id: string,
  signal?: AbortSignal,
): Promise<"processed" | "ignored" | "failed" | "deferred"> {
  if (signal?.aborted) return "deferred";
  const inbox = getStorage().webhooks;
  const event = await inbox.read(id);
  if (
    !event ||
    event.processingState === "processed" ||
    event.processingState === "ignored"
  )
    return "processed";
  const attemptId = event.providerOrderId
    ? await inbox.paymentForOrder(event.environment, event.providerOrderId)
    : undefined;
  if (!attemptId) {
    await inbox.mark(id, "ignored");
    return "ignored";
  }
  try {
    await reconcilePayment({ kind: "job", trigger: "webhook" }, attemptId, {
      mayCapture: event.eventType === "CHECKOUT.ORDER.APPROVED",
      signal,
    });
    if (signal?.aborted) return "deferred";
    await inbox.mark(id, "processed");
    return "processed";
  } catch (error) {
    await inbox.failed(id, error instanceof Error ? error.message : "unknown");
    return "failed";
  }
}

export async function listDueWebhookEvents(limit: number): Promise<string[]> {
  return getStorage().webhooks.due(limit);
}
