import { parseOriginList } from "@/lib/origin";
import { auditEvent, seller } from "@/server/db/sqlite/schema";
import { conflict, DomainError, invalid } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { SellerProfileInput, type SellerRow } from "@/server/domain/seller";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

/** Complete native seller settings operations; writes include the audit atomically. */
export function createD1SellerStorage(db: D1Db) {
  return {
    async getSeller(): Promise<SellerRow | null> {
      return (await db.select().from(seller).limit(1))[0] ?? null;
    },
    async findSellerForUser(userId: string): Promise<SellerRow | null> {
      return (
        (
          await db
            .select()
            .from(seller)
            .where(eq(seller.ownerUserId, userId))
            .limit(1)
        )[0] ?? null
      );
    },
    async updateSellerProfile(
      owner: OwnerPrincipal,
      raw: SellerProfileInput,
    ): Promise<SellerRow> {
      const input = SellerProfileInput.parse(raw);
      const origins = parseOriginList(input.allowedOrigins);
      if (origins.rejected.length)
        throw invalid(
          `These website origins are not exact origins: ${origins.rejected.join(", ")}. Use the form https://shop.example.com with no path or wildcard.`,
        );
      const [current] = await db
        .select()
        .from(seller)
        .where(
          and(
            eq(seller.id, owner.sellerId),
            eq(seller.ownerUserId, owner.userId),
          ),
        );
      if (!current)
        throw new DomainError(
          "unauthorized",
          "Sign in as the owner to change settings.",
        );
      if (current.policyRevision !== input.expectedPolicyRevision)
        throw conflict(
          "Settings changed in another tab. Reload to see the latest version.",
        );
      const policyChanged = (
        [
          "pickupPolicy",
          "serviceRequestPolicy",
          "digitalAccessPolicy",
          "cancellationPolicy",
          "taxPolicy",
        ] as const
      ).some((field) => current[field] !== input[field]);
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:settings`,
            sql`${ownerScope(owner)} and exists(select 1 from seller where id=${owner.sellerId} and policy_revision=${current.policyRevision} and updated_at=${current.updatedAt.getTime()})`,
          ),
          db
            .update(seller)
            .set({
              displayName: input.displayName,
              contactEmail: input.contactEmail,
              country: input.country,
              pickupPolicy: input.pickupPolicy,
              serviceRequestPolicy: input.serviceRequestPolicy,
              digitalAccessPolicy: input.digitalAccessPolicy,
              cancellationPolicy: input.cancellationPolicy,
              taxPolicy: input.taxPolicy,
              allowedOrigins: origins.valid,
              buyerTurnsPer10Min: input.buyerTurnsPer10Min,
              sellerDailyAiTurns: input.sellerDailyAiTurns,
              ...(input.theme ? { theme: input.theme } : {}),
              policyRevision: policyChanged
                ? current.policyRevision + 1
                : current.policyRevision,
            })
            .where(eq(seller.id, owner.sellerId))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "seller.update",
              targetType: "seller",
              targetId: owner.sellerId,
              outcome: "ok",
              details: { policyChanged, origins: origins.valid.length },
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "Settings changed in another tab. Reload to see the latest version.",
          );
        throw error;
      }
    },
  };
}
