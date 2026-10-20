import type { Db } from "@/server/db/client";
import { paymentAttempt, webhookEvent } from "@/server/db/schema";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { WebhookStorage } from "../webhooks";

/** PostgreSQL native verified-event inbox and retry bookkeeping. */
export function createPostgresWebhookStorage(db: Db): WebhookStorage {
  return {
    async receive(event) {
      return (
        await db
          .insert(webhookEvent)
          .values({ ...event, processingState: "received" })
          .onConflictDoNothing()
          .returning({ id: webhookEvent.id })
      )[0]?.id;
    },
    async read(id) {
      return (
        await db.select().from(webhookEvent).where(eq(webhookEvent.id, id))
      )[0];
    },
    async paymentForOrder(environment, id) {
      return (
        await db
          .select({ id: paymentAttempt.id })
          .from(paymentAttempt)
          .where(
            and(
              eq(paymentAttempt.environment, environment),
              eq(paymentAttempt.providerOrderId, id),
            ),
          )
      )[0]?.id;
    },
    async mark(id, state) {
      await db
        .update(webhookEvent)
        .set({
          processingState: state,
          processedAt: new Date(),
          ...(state === "processed" ? { lastError: null } : {}),
        })
        .where(eq(webhookEvent.id, id));
    },
    async failed(id, problem) {
      await db
        .update(webhookEvent)
        .set({
          processingState: "failed",
          attempts: sql`${webhookEvent.attempts}+1`,
          lastError: problem.slice(0, 200),
          nextAttemptAt: sql`now()+make_interval(secs=>least(3600,30*power(2,${webhookEvent.attempts})::int))`,
        })
        .where(eq(webhookEvent.id, id));
    },
    async due(limit) {
      return (
        await db
          .select({ id: webhookEvent.id })
          .from(webhookEvent)
          .where(
            and(
              inArray(webhookEvent.processingState, ["received", "failed"]),
              lte(webhookEvent.nextAttemptAt, sql`now()`),
            ),
          )
          .orderBy(webhookEvent.receivedAt)
          .limit(limit)
      ).map((row) => row.id);
    },
  };
}
