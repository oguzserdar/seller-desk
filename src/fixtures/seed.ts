/**
 * Fills an empty shop with a fictional preset. Shared by `pnpm db:seed` and
 * the integration tests, so the demo data and the tested data are the same.
 */
import { bootstrapOwner } from "@/server/auth/bootstrap";
import { randomToken } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { offer } from "@/server/db/schema";
import { offer as nativeOffer } from "@/server/db/sqlite/schema";
import { storeAsset } from "@/server/domain/digital";
import { saveOffer, setOfferPublished } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import {
  getSeller,
  updateSellerProfile,
  type SellerRow,
} from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";
import { getRequestScope } from "@/server/request-scope";
import { eq } from "drizzle-orm";
import { PRESETS, type PresetKey } from "./presets";
import {
  BRAKE_GUIDE_FILENAME,
  buildBrakeGuide,
  buildSamplePack,
  SAMPLE_PACK_FILENAME,
} from "./sample-asset";

export const FIXTURE_OWNER_EMAIL = "owner@example.test";

export type SeedResult =
  | {
      outcome: "seeded";
      owner: OwnerPrincipal;
      seller: SellerRow;
      offers: number;
      fixturePassword: string | null;
    }
  | { outcome: "not_empty" };

export async function seedShop(options: {
  preset: PresetKey;
  origins: string[];
  fixturePassword?: string;
}): Promise<SeedResult> {
  const preset = PRESETS[options.preset];
  const native = getRequestScope()?.d1;
  const db = native ? null : getDb();
  let sellerRow = await getSeller();
  let fixturePassword: string | null = null;
  if (!sellerRow) {
    if (getServerConfig().mode !== "fixture")
      throw new Error("Create the owner first with `pnpm owner:bootstrap`.");
    fixturePassword = options.fixturePassword ?? randomToken(15);
    await bootstrapOwner({
      email: FIXTURE_OWNER_EMAIL,
      password: fixturePassword,
      displayName: preset.sellerName,
      country: "CA",
      currency: "USD",
      contactEmail: "hello@example.test",
    });
    sellerRow = await getSeller();
  }
  if (!sellerRow) throw new Error("Owner setup did not create a shop.");

  const [existingOffer] = native
    ? await native
        .select({ id: nativeOffer.id })
        .from(nativeOffer)
        .where(eq(nativeOffer.sellerId, sellerRow.id))
        .limit(1)
    : await db!
        .select({ id: offer.id })
        .from(offer)
        .where(eq(offer.sellerId, sellerRow.id))
        .limit(1);
  if (existingOffer) return { outcome: "not_empty" };

  const owner: OwnerPrincipal = {
    kind: "owner",
    userId: sellerRow.ownerUserId,
    sellerId: sellerRow.id,
  };
  sellerRow = await updateSellerProfile(owner, {
    expectedPolicyRevision: sellerRow.policyRevision,
    displayName: preset.sellerName,
    contactEmail: sellerRow.contactEmail,
    country: sellerRow.country,
    ...preset.policies,
    allowedOrigins: options.origins,
    buyerTurnsPer10Min: 10,
    sellerDailyAiTurns: 500,
  });

  const DOWNLOADS = {
    northlight: { filename: SAMPLE_PACK_FILENAME, build: buildSamplePack },
    "brake-guide": { filename: BRAKE_GUIDE_FILENAME, build: buildBrakeGuide },
  } as const;
  const assetIds = new Map<string, string>();
  for (const kind of new Set(
    preset.offers.flatMap((item) => (item.download ? [item.download] : [])),
  )) {
    const file = DOWNLOADS[kind];
    assetIds.set(
      kind,
      (
        await storeAsset(owner, {
          filename: file.filename,
          bytes: file.build(),
        })
      ).id,
    );
  }
  for (const [index, item] of preset.offers.entries()) {
    const saved = await saveOffer(owner, sellerRow, {
      kind: item.kind,
      title: item.title,
      description: item.description,
      unitAmountMinor: item.unitAmountMinor,
      fulfillmentNote: item.fulfillmentNote,
      requiresScopeReview: item.requiresScopeReview ?? false,
      serviceScope: item.serviceScope ?? null,
      accessDays: item.accessDays ?? null,
      digitalAssetId: item.download
        ? (assetIds.get(item.download) ?? null)
        : null,
      maxQuantity: item.maxQuantity,
      stockTotal: item.kind === "goods" ? (item.stock ?? 0) : null,
      imagePath: item.imagePath ?? null,
    });
    if (native)
      await native
        .update(nativeOffer)
        .set({ sortOrder: index })
        .where(eq(nativeOffer.id, saved.id));
    else
      await db!
        .update(offer)
        .set({ sortOrder: index })
        .where(eq(offer.id, saved.id));
    await setOfferPublished(owner, sellerRow, {
      offerId: saved.id,
      expectedRevision: saved.revision,
      published: true,
    });
  }
  return {
    outcome: "seeded",
    owner,
    seller: sellerRow,
    offers: preset.offers.length,
    fixturePassword,
  };
}
