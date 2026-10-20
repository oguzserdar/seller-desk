import { sha256Hex } from "@/server/crypto";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  accessGrant,
  auditEvent,
  digitalQuoteLine,
  fulfillmentTask,
  job,
  orders,
} from "@/server/db/sqlite/schema";
import { AssistantTurnEnded } from "@/server/domain/assistant-turn";
import {
  grantToken,
  inspectAccess,
  type GrantOutcome,
} from "@/server/domain/digital";
import { DomainError, notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, Principal } from "@/server/domain/principal";
import { getServerConfig } from "@/server/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { takeD1Fault } from "./fixture-fault";
import {
  assertD1BuyerScope,
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

type Actor = { actor: "owner" | "buyer" | "job"; actorId: string };
function actorScope(
  actor: Actor,
  order: typeof orders.$inferSelect,
  assistant?: BuyerPrincipal,
) {
  const authority =
    actor.actor === "owner"
      ? ownerScope({
          kind: "owner",
          userId: actor.actorId,
          sellerId: order.sellerId,
        })
      : actor.actor === "buyer"
        ? sql`${order.buyerSessionId}=${actor.actorId}`
        : sql`1`;
  return sql`${authority} and ${assistant ? sql`${buyerScope(assistant)} and ${assistant.buyerSessionId}=${order.buyerSessionId} and ${assistant.sellerId}=${order.sellerId}` : sql`1`}`;
}

async function grant(
  db: D1Db,
  order: typeof orders.$inferSelect,
  actor: Actor,
  assistant?: BuyerPrincipal,
) {
  const digitalIds = order.snapshot.lines
    .filter((line) => line.kind === "digital")
    .map((line) => line.offerId);
  const [tasks, sources, grants] = await db.batch([
    db
      .select()
      .from(fulfillmentTask)
      .where(
        and(
          eq(fulfillmentTask.orderId, order.id),
          eq(fulfillmentTask.type, "digital_access"),
        ),
      ),
    db
      .select()
      .from(digitalQuoteLine)
      .where(
        and(
          eq(digitalQuoteLine.quoteId, order.quoteId),
          inArray(digitalQuoteLine.offerId, digitalIds),
        ),
      ),
    db.select().from(accessGrant).where(eq(accessGrant.orderId, order.id)),
  ]);
  const task = tasks[0];
  if (!task) throw new Error("digital order without access task");
  const review =
    actor.actor === "buyer"
      ? "Contact the seller to review access."
      : "Review the purchased access terms with the buyer. This retry cannot renew or reinstate access.";
  const planned = new Map<string, { id: string; expiresAt: Date }>();
  const decisions = digitalIds.map((offerId) => {
    const source = sources.find((source) => source.offerId === offerId),
      existing = source
        ? grants.find((grant) => grant.assetId === source.assetId)
        : undefined;
    const first = source ? planned.get(source.assetId) : undefined;
    // The first purchased line for an asset establishes its grant, just as the
    // PostgreSQL transaction does. Another line must not silently extend it.
    const checked = inspectAccess(
      source,
      existing ??
        (first ? { state: "active", expiresAt: first.expiresAt } : undefined),
      order.paidAt,
      new Date(),
    );
    if (!checked.ok)
      throw new DomainError(
        checked.block.code,
        `${checked.block.reason} ${review}`,
      );
    const id = existing?.id ?? first?.id ?? crypto.randomUUID();
    planned.set(checked.source.assetId, { id, expiresAt: checked.expiresAt });
    return {
      offerId,
      source: checked.source,
      expiresAt: checked.expiresAt,
      existing,
      id,
    };
  });
  const unique = decisions.filter(
    (row, index) =>
      decisions.findIndex(
        (other) => other.source.assetId === row.source.assetId,
      ) === index,
  );
  const facts = decisions.map((row) => ({
    offerId: row.offerId,
    assetId: row.source.assetId,
    days: row.source.accessDays,
    id: row.existing?.id ?? null,
    state: row.existing?.state ?? null,
    expiry: row.existing?.expiresAt.getTime() ?? null,
    entitlementExpiry: row.expiresAt.getTime(),
  }));
  const execution = crypto.randomUUID(),
    created = unique.some((row) => !row.existing);
  await db.batch([
    batchGuard(
      db,
      `${execution}:grant`,
      sql`${actorScope(actor, order, assistant)}
      and exists(select 1 from orders where id=${order.id} and quote_id=${order.quoteId} and paid_at=${order.paidAt.getTime()} and seller_id=${order.sellerId} and buyer_session_id=${order.buyerSessionId})
      and exists(select 1 from fulfillment_task where id=${task.id} and order_id=${order.id} and state=${task.state} and revision=${task.revision})
      and not exists(select 1 from json_each(${JSON.stringify(facts)}) f left join digital_quote_line d on d.quote_id=${order.quoteId} and d.offer_id=json_extract(f.value,'$.offerId') left join access_grant g on g.order_id=${order.id} and g.asset_id=json_extract(f.value,'$.assetId')
        where d.asset_id is not json_extract(f.value,'$.assetId') or d.access_days is not json_extract(f.value,'$.days') or g.id is not json_extract(f.value,'$.id') or g.state is not json_extract(f.value,'$.state') or g.expires_at is not json_extract(f.value,'$.expiry')
          or json_extract(f.value,'$.entitlementExpiry')<=${nowMilliseconds})`,
    ),
    ...(unique.some((row) => !row.existing)
      ? [
          db
            .insert(accessGrant)
            .select(
              db
                .select({
                  id: sql<string>`json_extract(j.value,'$.id')`.as("id"),
                  orderId: sql<string>`${order.id}`.as("order_id"),
                  assetId: sql<string>`json_extract(j.value,'$.assetId')`.as(
                    "asset_id",
                  ),
                  capabilityHash:
                    sql<string>`json_extract(j.value,'$.hash')`.as(
                      "capability_hash",
                    ),
                  state: sql<"active">`'active'`.as("state"),
                  expiresAt: sql<Date>`json_extract(j.value,'$.expiresAt')`.as(
                    "expires_at",
                  ),
                  downloadCount: sql<number>`0`.as("download_count"),
                  lastDownloadAt: sql<Date>`null`.as("last_download_at"),
                  createdAt: nowMilliseconds.as("created_at"),
                  updatedAt: nowMilliseconds.as("updated_at"),
                })
                .from(
                  sql`json_each(${JSON.stringify(unique.filter((row) => !row.existing).map((row) => ({ id: row.id, assetId: row.source.assetId, hash: sha256Hex(grantToken(row.id)), expiresAt: row.expiresAt.getTime() })))}) j`,
                ),
            ),
        ]
      : []),
    db
      .update(fulfillmentTask)
      .set({
        state: "completed",
        completedAt: task.completedAt ?? new Date(),
        lastError: null,
        details: { ...task.details, grantId: unique[0]?.id },
      })
      .where(eq(fulfillmentTask.id, task.id)),
    db
      .update(job)
      .set({ state: "done", lastError: null })
      .where(and(eq(job.kind, "grant_access"), eq(job.targetId, order.id))),
    db
      .insert(auditEvent)
      .values({
        ...actor,
        operation: "access.grant",
        targetType: "order",
        targetId: order.id,
        outcome: created ? "ok" : "noop",
      }),
    clearBatchGuards(db, execution),
  ]);
  return { grantIds: unique.map((row) => row.id), created };
}

/** Native D1 digital delivery retains existing expiry and revocation decisions. */
export function createD1DigitalGrants(db: D1Db) {
  const issueGrants = async (
    orderId: string,
    actor: Actor,
    assistant?: BuyerPrincipal,
  ): Promise<GrantOutcome> => {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) return { outcome: "not_eligible", reason: "order_not_found" };
    if (!order.snapshot.lines.some((line) => line.kind === "digital"))
      return { outcome: "not_eligible", reason: "no_digital_lines" };
    try {
      if (
        getServerConfig().mode === "fixture" &&
        (await takeD1Fault(db, "access_storage_error"))
      )
        throw new Error("Fixture: file storage unavailable");
      for (let retry = 0; retry < 2; retry++) {
        try {
          return {
            outcome: "granted",
            ...(await grant(db, order, actor, assistant)),
          };
        } catch (error) {
          if (!isBatchGuardFailure(error) || retry === 1) throw error;
          if (assistant) await assertD1BuyerScope(db, assistant);
        }
      }
      throw new Error("Access changed before delivery. Retry the saved order.");
    } catch (error) {
      if (error instanceof AssistantTurnEnded) throw error;
      if (assistant) await assertD1BuyerScope(db, assistant);
      const reason =
        error instanceof Error ? error.message.slice(0, 200) : "unknown error";
      const permanent =
        error instanceof DomainError &&
        (error.code === "expired" || error.code === "invalid");
      const execution = crypto.randomUUID();
      await db.batch([
        batchGuard(
          db,
          `${execution}:failed-grant`,
          actorScope(actor, order, assistant),
        ),
        ...(permanent
          ? [
              db
                .update(job)
                .set({ state: "failed", lastError: reason })
                .where(
                  and(
                    eq(job.kind, "grant_access"),
                    eq(job.targetId, orderId),
                    eq(job.state, "pending"),
                  ),
                ),
            ]
          : [
              db
                .update(fulfillmentTask)
                .set({
                  state: "attention",
                  retryCount: sql`${fulfillmentTask.retryCount}+1`,
                  lastError: reason,
                  details: sql`json_patch(${fulfillmentTask.details},${JSON.stringify({ lastAttemptAt: new Date().toISOString() })})`,
                })
                .where(
                  and(
                    eq(fulfillmentTask.orderId, orderId),
                    eq(fulfillmentTask.type, "digital_access"),
                    sql`${fulfillmentTask.state}<>'completed'`,
                  ),
                ),
              db
                .update(job)
                .set({
                  state: "pending",
                  attempts: sql`${job.attempts}+1`,
                  lastError: reason,
                  runAfter: sql`${nowMilliseconds}+min(3600,30*(1<<min(${job.attempts},7)))*1000`,
                })
                .where(
                  and(eq(job.kind, "grant_access"), eq(job.targetId, orderId)),
                ),
            ]),
        db
          .insert(auditEvent)
          .values({
            ...actor,
            operation: "access.grant",
            targetType: "order",
            targetId: orderId,
            outcome: permanent ? "noop" : "failed",
            details: { reason },
          }),
        clearBatchGuards(db, execution),
      ]);
      return { outcome: permanent ? "not_eligible" : "failed", reason };
    }
  };
  return {
    issueGrants,
    async retryAccess(
      principal: Principal,
      orderId: string,
    ): Promise<GrantOutcome> {
      if (principal.kind === "buyer" && principal.assistantTurn)
        await assertD1BuyerScope(db, principal);
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      if (
        !order ||
        (principal.kind === "owner" && order.sellerId !== principal.sellerId) ||
        (principal.kind === "buyer" &&
          (order.buyerSessionId !== principal.buyerSessionId ||
            order.sellerId !== principal.sellerId))
      )
        throw notFound("order");
      const actor =
        principal.kind === "owner"
          ? { actor: "owner" as const, actorId: principal.userId }
          : principal.kind === "buyer"
            ? { actor: "buyer" as const, actorId: principal.buyerSessionId }
            : { actor: "job" as const, actorId: principal.trigger };
      return issueGrants(
        orderId,
        actor,
        principal.kind === "buyer" ? principal : undefined,
      );
    },
  };
}
