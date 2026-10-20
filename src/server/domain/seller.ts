import { parseOriginList } from "@/lib/origin";
import { SHOP_THEME_IDS } from "@/lib/shop-themes";
import { getDb, type Queryable, transaction } from "@/server/db/client";
import { seller } from "@/server/db/schema";
import type { PolicySnapshot } from "@/server/db/types";
import { getStorage } from "@/server/storage";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, DomainError, invalid } from "./errors";
import type { OwnerPrincipal } from "./principal";

export type SellerRow = typeof seller.$inferSelect;

/** The installation's single seller, or null before setup. */
export async function getSeller(q?: Queryable): Promise<SellerRow | null> {
  const backend = getStorage();
  if (!q && backend.kind === "d1") return backend.seller.getSeller();
  q ??= getDb();

  const [row] = await q.select().from(seller).limit(1);
  return row ?? null;
}

/** The seller owned by this user. Anyone else is not an owner of this installation. */
export async function findSellerForUser(
  userId: string,
  q?: Queryable,
): Promise<SellerRow | null> {
  const backend = getStorage();
  if (!q && backend.kind === "d1")
    return backend.seller.findSellerForUser(userId);
  q ??= getDb();

  const [row] = await q
    .select()
    .from(seller)
    .where(eq(seller.ownerUserId, userId))
    .limit(1);
  return row ?? null;
}

export function policySnapshotOf(row: SellerRow): PolicySnapshot {
  return {
    policyRevision: row.policyRevision,
    sellerName: row.displayName,
    pickupPolicy: row.pickupPolicy,
    serviceRequestPolicy: row.serviceRequestPolicy,
    digitalAccessPolicy: row.digitalAccessPolicy,
    cancellationPolicy: row.cancellationPolicy,
    taxPolicy: row.taxPolicy,
  };
}

const policyText = z
  .string()
  .trim()
  .max(1000)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const SellerProfileInput = z
  .object({
    expectedPolicyRevision: z.number().int().min(1),
    displayName: z.string().trim().min(1).max(80),
    contactEmail: z.email().max(200),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, "Use a two-letter country code such as CA or US."),
    pickupPolicy: policyText,
    serviceRequestPolicy: policyText,
    digitalAccessPolicy: policyText,
    cancellationPolicy: policyText,
    taxPolicy: policyText,
    allowedOrigins: z.array(z.string().max(255)).max(10),
    buyerTurnsPer10Min: z.number().int().min(1).max(100),
    sellerDailyAiTurns: z.number().int().min(1).max(100000),
    /** A curated shop palette; omitted keeps the current one. Colours never change policy terms. */
    theme: z.enum(SHOP_THEME_IDS).optional(),
  })
  .strict();

export type SellerProfileInput = z.input<typeof SellerProfileInput>;

const POLICY_FIELDS = [
  "pickupPolicy",
  "serviceRequestPolicy",
  "digitalAccessPolicy",
  "cancellationPolicy",
  "taxPolicy",
] as const;

/**
 * Saves the seller's identity, policies and widget origins.
 * Policy text changes bump `policyRevision`, which makes open quotes re-review.
 */
export async function updateSellerProfile(
  owner: OwnerPrincipal,
  raw: SellerProfileInput,
): Promise<SellerRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.seller.updateSellerProfile(owner, raw);

  const input = SellerProfileInput.parse(raw);
  const origins = parseOriginList(input.allowedOrigins);
  if (origins.rejected.length > 0) {
    throw invalid(
      `These website origins are not exact origins: ${origins.rejected.join(", ")}. Use the form https://shop.example.com with no path or wildcard.`,
    );
  }
  return transaction(getDb(), async (tx) => {
    const [current] = await tx
      .select()
      .from(seller)
      .where(eq(seller.id, owner.sellerId))
      .for("update");
    if (!current)
      throw new DomainError(
        "unauthorized",
        "Sign in as the owner to change settings.",
      );
    if (current.policyRevision !== input.expectedPolicyRevision) {
      throw conflict(
        "Settings changed in another tab. Reload to see the latest version.",
      );
    }
    const policyChanged = POLICY_FIELDS.some(
      (field) => current[field] !== input[field],
    );
    const [updated] = await tx
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
      .returning();
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "seller.update",
      targetType: "seller",
      targetId: owner.sellerId,
      outcome: "ok",
      details: { policyChanged, origins: origins.valid.length },
    });
    return updated as SellerRow;
  });
}
