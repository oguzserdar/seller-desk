import type { webhookEvent } from "@/server/db/schema";
import type { Environment, WebhookSummary } from "@/server/db/types";

/** A verified notification retained independently of its processing result. */
export type VerifiedWebhook = {
  environment: Environment;
  providerEventId: string;
  eventType: string;
  providerOrderId: string | null;
  summary: WebhookSummary;
};
/** Durable inbox operations; notification bodies never directly mark payments paid. */
export type WebhookStorage = {
  receive: (event: VerifiedWebhook) => Promise<string | undefined>;
  read: (id: string) => Promise<typeof webhookEvent.$inferSelect | undefined>;
  paymentForOrder: (
    environment: Environment,
    orderId: string,
  ) => Promise<string | undefined>;
  mark: (id: string, state: "processed" | "ignored") => Promise<void>;
  failed: (id: string, problem: string) => Promise<void>;
  due: (limit: number) => Promise<string[]>;
};
