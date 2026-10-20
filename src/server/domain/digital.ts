import { getStorage } from "@/server/storage";
/**
 * Private digital delivery. Files live in PostgreSQL (1 MiB limit), never in
 * public/. A paid order gets one access grant per asset; granting is a separate
 * step from payment and can fail and be retried without charging again.
 */
import { takeFault } from "@/fixtures/paypal-fixture";
import { sha256Hex } from "@/server/crypto";
import { getDb, transaction } from "@/server/db/client";
import {
  accessGrant,
  digitalAsset,
  digitalQuoteLine,
  fulfillmentTask,
  job,
  orders,
} from "@/server/db/schema";
import { getServerConfig } from "@/server/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { assertAssistantTurn, AssistantTurnEnded } from "./assistant-turn";
import { recordAudit } from "./audit";
import { DomainError, invalid, notFound } from "./errors";
import type { BuyerPrincipal, OwnerPrincipal, Principal } from "./principal";

export const MAX_ASSET_BYTES = 1024 * 1024;

const SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

/** Identifies a file by its first bytes, not by its name or the browser's claim. */
export function sniffMime(bytes: Uint8Array): string | null {
  return (
    SIGNATURES.find((sig) => sig.bytes.every((byte, i) => bytes[i] === byte))
      ?.mime ?? null
  );
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "download";
  const cleaned = base
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100);
  return cleaned || "download";
}

export async function storeAsset(
  owner: OwnerPrincipal,
  file: { filename: string; bytes: Buffer },
): Promise<{
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
}> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.digital.storeAsset(owner, file);

  if (file.bytes.length === 0) throw invalid("The file is empty.");
  if (file.bytes.length > MAX_ASSET_BYTES)
    throw invalid("Files can be at most 1 MiB in this release.");
  const mimeType = sniffMime(file.bytes);
  if (!mimeType) throw invalid("Upload a ZIP, PDF, PNG or JPEG file.");
  const filename = safeFilename(file.filename);
  const [created] = await getDb()
    .insert(digitalAsset)
    .values({
      sellerId: owner.sellerId,
      filename,
      mimeType,
      sizeBytes: file.bytes.length,
      sha256: sha256Hex(file.bytes),
      bytes: file.bytes,
    })
    .returning({ id: digitalAsset.id });
  if (!created) throw new Error("asset insert returned nothing");
  await recordAudit(getDb(), {
    actor: "owner",
    actorId: owner.userId,
    operation: "asset.upload",
    targetType: "digital_asset",
    targetId: created.id,
    outcome: "ok",
    details: { sizeBytes: file.bytes.length, mimeType },
  });
  return { id: created.id, filename, sizeBytes: file.bytes.length, mimeType };
}

/** A grant's download token, recomputed from the server secret so only its hash is stored. */
export function grantToken(grantId: string): string {
  return createHmac("sha256", getServerConfig().authSecret)
    .update(`seller-desk-grant:${grantId}`)
    .digest("base64url");
}

export type GrantOutcome =
  | { outcome: "granted"; grantIds: string[]; created: boolean }
  | { outcome: "failed"; reason: string }
  | { outcome: "not_eligible"; reason: string };

/** Frozen private file terms of the purchased quote. */
export type DeliverySource = Pick<
  typeof digitalQuoteLine.$inferSelect,
  "assetId" | "accessDays"
>;
/** Existing access decisions must never be silently renewed or reinstated. */
export type ExistingGrant = Pick<
  typeof accessGrant.$inferSelect,
  "state" | "expiresAt"
>;
/** A permanent access limitation requiring seller review. */
export type AccessBlock = { code: "invalid" | "expired"; reason: string };
/** Already-authorized paid order fields needed for access eligibility. */
export type AccessOrder = Pick<
  typeof orders.$inferSelect,
  "id" | "quoteId" | "paidAt" | "snapshot"
>;

/** One eligibility rule for delivery, read views and reviewed owner proposals. */
/** Applies purchased access terms without renewing an existing grant. */
export function inspectAccess(
  source: DeliverySource | undefined,
  existing: ExistingGrant | undefined,
  paidAt: Date,
  now: Date,
):
  | { ok: true; source: DeliverySource; expiresAt: Date }
  | { ok: false; block: AccessBlock } {
  if (!source)
    return {
      ok: false,
      block: {
        code: "invalid",
        reason: "The original download details could not be verified.",
      },
    };
  if (existing && existing.state !== "active")
    return {
      ok: false,
      block: { code: "invalid", reason: "Download access was withdrawn." },
    };
  const expiresAt =
    existing?.expiresAt ??
    new Date(paidAt.getTime() + source.accessDays * 86_400_000);
  if (expiresAt <= now)
    return {
      ok: false,
      block: {
        code: "expired",
        reason: existing
          ? "Download access has expired."
          : "The download access period has ended.",
      },
    };
  return { ok: true, source, expiresAt };
}

/** Reads blocked access for already-authorized order rows, without changing delivery history. */
export async function getDigitalAccessBlocks(
  authorizedOrders: AccessOrder[],
): Promise<Map<string, AccessBlock>> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.digital.getDigitalAccessBlocks(authorizedOrders);

  const digitalOrders = authorizedOrders.filter((order) =>
    order.snapshot.lines.some((line) => line.kind === "digital"),
  );
  const result = new Map<string, AccessBlock>();
  if (!digitalOrders.length) return result;
  const db = getDb();
  const sources = await db
    .select()
    .from(digitalQuoteLine)
    .where(
      inArray(
        digitalQuoteLine.quoteId,
        digitalOrders.map((order) => order.quoteId),
      ),
    );
  const grants = await db
    .select({
      orderId: accessGrant.orderId,
      assetId: accessGrant.assetId,
      state: accessGrant.state,
      expiresAt: accessGrant.expiresAt,
    })
    .from(accessGrant)
    .where(
      inArray(
        accessGrant.orderId,
        digitalOrders.map((order) => order.id),
      ),
    );
  const bySource = new Map(
    sources.map((source) => [`${source.quoteId}:${source.offerId}`, source]),
  );
  const byGrant = new Map(
    grants.map((grant) => [`${grant.orderId}:${grant.assetId}`, grant]),
  );
  const now = new Date();
  for (const order of digitalOrders) {
    for (const line of order.snapshot.lines.filter(
      (line) => line.kind === "digital",
    )) {
      const source = bySource.get(`${order.quoteId}:${line.offerId}`);
      const checked = inspectAccess(
        source,
        source ? byGrant.get(`${order.id}:${source.assetId}`) : undefined,
        order.paidAt,
        now,
      );
      if (!checked.ok) {
        result.set(order.id, checked.block);
        break;
      }
    }
  }
  return result;
}

/**
 * Creates the access grant for each digital line of a paid order. Safe to
 * repeat: unique (order, asset) keeps one grant. Repeats return only usable
 * access; they never renew expired access or reverse a seller's revocation.
 */
export async function issueGrants(
  orderId: string,
  actor: { actor: "owner" | "buyer" | "job"; actorId: string },
  assistant?: BuyerPrincipal,
): Promise<GrantOutcome> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.digital.issueGrants(orderId, actor, assistant);

  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { outcome: "not_eligible", reason: "order_not_found" };
  const digitalOfferIds = order.snapshot.lines
    .filter((line) => line.kind === "digital")
    .map((line) => line.offerId);
  if (digitalOfferIds.length === 0)
    return { outcome: "not_eligible", reason: "no_digital_lines" };
  const reviewAccess =
    actor.actor === "buyer"
      ? "Contact the seller to review access."
      : "Review the purchased access terms with the buyer. This retry cannot renew or reinstate access.";

  try {
    if (
      getServerConfig().mode === "fixture" &&
      (await takeFault(db, "access_storage_error"))
    ) {
      throw new Error("Fixture: file storage unavailable");
    }
    const result = await transaction(db, async (tx) => {
      if (assistant) await assertAssistantTurn(assistant, tx, true);
      const [task] = await tx
        .select()
        .from(fulfillmentTask)
        .where(
          and(
            eq(fulfillmentTask.orderId, orderId),
            eq(fulfillmentTask.type, "digital_access"),
          ),
        )
        .for("update");
      if (!task) throw new Error("digital order without access task");
      const grantIds: string[] = [];
      let created = false;
      for (const offerId of digitalOfferIds) {
        const [source] = await tx
          .select({
            assetId: digitalQuoteLine.assetId,
            accessDays: digitalQuoteLine.accessDays,
          })
          .from(digitalQuoteLine)
          .where(
            and(
              eq(digitalQuoteLine.quoteId, order.quoteId),
              eq(digitalQuoteLine.offerId, offerId),
            ),
          );
        const [existing] = source
          ? await tx
              .select({
                id: accessGrant.id,
                state: accessGrant.state,
                expiresAt: accessGrant.expiresAt,
              })
              .from(accessGrant)
              .where(
                and(
                  eq(accessGrant.orderId, orderId),
                  eq(accessGrant.assetId, source.assetId),
                ),
              )
          : [];
        const checked = inspectAccess(
          source,
          existing,
          order.paidAt,
          new Date(),
        );
        if (!checked.ok)
          throw new DomainError(
            checked.block.code,
            `${checked.block.reason} ${reviewAccess}`,
          );
        if (existing) {
          grantIds.push(existing.id);
          continue;
        }
        const id = crypto.randomUUID();
        await tx.insert(accessGrant).values({
          id,
          orderId,
          assetId: checked.source.assetId,
          capabilityHash: sha256Hex(grantToken(id)),
          state: "active",
          expiresAt: checked.expiresAt,
        });
        grantIds.push(id);
        created = true;
      }
      await tx
        .update(fulfillmentTask)
        .set({
          state: "completed",
          completedAt: task.completedAt ?? new Date(),
          lastError: null,
          details: { ...task.details, grantId: grantIds[0] },
        })
        .where(eq(fulfillmentTask.id, task.id));
      await tx
        .update(job)
        .set({ state: "done", lastError: null })
        .where(and(eq(job.kind, "grant_access"), eq(job.targetId, orderId)));
      await recordAudit(tx, {
        ...actor,
        operation: "access.grant",
        targetType: "order",
        targetId: orderId,
        outcome: created ? "ok" : "noop",
      });
      return { grantIds, created };
    });
    return { outcome: "granted", ...result };
  } catch (error) {
    if (error instanceof AssistantTurnEnded) throw error;
    return transaction(db, async (tx) => {
      if (assistant) await assertAssistantTurn(assistant, tx, true);
      const reason =
        error instanceof Error ? error.message.slice(0, 200) : "unknown error";
      if (
        error instanceof DomainError &&
        (error.code === "expired" || error.code === "invalid")
      ) {
        // Permanent access decisions need the seller, not a background retry loop.
        await tx
          .update(job)
          .set({ state: "failed", lastError: reason })
          .where(
            and(
              eq(job.kind, "grant_access"),
              eq(job.targetId, orderId),
              eq(job.state, "pending"),
            ),
          );
        await recordAudit(tx, {
          ...actor,
          operation: "access.grant",
          targetType: "order",
          targetId: orderId,
          outcome: "noop",
          details: { reason },
        });
        return { outcome: "not_eligible" as const, reason };
      }
      await tx
        .update(fulfillmentTask)
        .set({
          state: "attention",
          retryCount: sql`${fulfillmentTask.retryCount} + 1`,
          lastError: reason,
          details: sql`${fulfillmentTask.details} || ${JSON.stringify({ lastAttemptAt: new Date().toISOString() })}::jsonb`,
        })
        .where(
          and(
            eq(fulfillmentTask.orderId, orderId),
            eq(fulfillmentTask.type, "digital_access"),
            sql`${fulfillmentTask.state} <> 'completed'`,
          ),
        );
      await tx
        .update(job)
        .set({
          state: "pending",
          attempts: sql`${job.attempts} + 1`,
          lastError: reason,
          runAfter: sql`now() + make_interval(secs => least(3600, 30 * power(2, ${job.attempts})::int))`,
        })
        .where(and(eq(job.kind, "grant_access"), eq(job.targetId, orderId)));
      await recordAudit(tx, {
        ...actor,
        operation: "access.grant",
        targetType: "order",
        targetId: orderId,
        outcome: "failed",
        details: { reason },
      });
      return { outcome: "failed" as const, reason };
    });
  }
}

/** Retry access for one order. Owner, or the buyer who paid for it. Never charges again. */
export async function retryAccess(
  principal: Principal,
  orderId: string,
): Promise<GrantOutcome> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.digital.retryAccess(principal, orderId);

  if (principal.kind === "buyer") await assertAssistantTurn(principal);
  const [order] = await getDb()
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) throw notFound("order");
  if (principal.kind === "owner" && order.sellerId !== principal.sellerId)
    throw notFound("order");
  if (
    principal.kind === "buyer" &&
    (order.buyerSessionId !== principal.buyerSessionId ||
      order.sellerId !== principal.sellerId)
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
}

export type Download = { filename: string; mimeType: string; bytes: Buffer };

/** Serves a protected file to a holder of the grant's token. Unpaid or unrelated callers get not found. */
export async function downloadWithGrant(
  grantId: string,
  token: string,
): Promise<Download> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.digital.downloadWithGrant(grantId, token);

  if (
    !/^[0-9a-f-]{36}$/i.test(grantId) ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(token)
  )
    throw notFound("download");
  const db = getDb();
  const [row] = await db
    .select({ grant: accessGrant, asset: digitalAsset })
    .from(accessGrant)
    .innerJoin(digitalAsset, eq(digitalAsset.id, accessGrant.assetId))
    .innerJoin(orders, eq(orders.id, accessGrant.orderId))
    .where(
      and(
        eq(accessGrant.id, grantId),
        eq(accessGrant.capabilityHash, sha256Hex(token)),
      ),
    );
  if (!row || row.grant.state !== "active") throw notFound("download");
  if (row.grant.expiresAt <= new Date()) {
    throw new DomainError(
      "expired",
      "This download link has expired. Contact the seller to renew access.",
      ["contact_seller"],
    );
  }
  await db
    .update(accessGrant)
    .set({
      downloadCount: sql`${accessGrant.downloadCount} + 1`,
      lastDownloadAt: new Date(),
    })
    .where(eq(accessGrant.id, grantId));
  return {
    filename: row.asset.filename,
    mimeType: row.asset.mimeType,
    bytes: row.asset.bytes,
  };
}
