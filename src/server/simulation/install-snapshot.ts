/** Materializes a shop snapshot only inside a verified empty simulation database. */
import { getDb, transaction } from "@/server/db/client";
import {
  assistantProcedure,
  assistantProcedureVersion,
  digitalAsset,
  installation,
  inventory,
  offer,
  seller,
  shopGuide,
  user,
} from "@/server/db/schema";
import { conflict } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getRequestScope } from "@/server/request-scope";
import { getStorage } from "@/server/storage";
import { eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { SimulationShopSnapshot } from "./snapshot";

/** Internal identities created in a fresh trial; never sent to a browser. */
export type SimulationInstallation = {
  owner: OwnerPrincipal;
  offerIds: Map<string, string>;
};

/**
 * Creates fictional identities and fresh offer ids from an internal source snapshot.
 * Refuses an occupied target; never clears records, copies login data or issues a login.
 * Digital products retain their price/terms but deliver an explicit test file.
 */
export async function installSimulationShop(
  snapshot: SimulationShopSnapshot,
): Promise<SimulationInstallation> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.simulation.installShop(snapshot);
  if (!getRequestScope()?.simulation)
    throw new Error(
      "Shop simulation setup requires an isolated simulation scope.",
    );
  return transaction(getDb(), async (tx) => {
    const [installed] = await tx
      .select()
      .from(installation)
      .where(eq(installation.singleton, true))
      .for("update");
    if (installed?.environment !== "fixture")
      throw new Error("Simulation installation is not fixture mode.");
    const [existingShop] = await tx
      .select({ id: seller.id })
      .from(seller)
      .limit(1);
    const [existingUser] = await tx.select({ id: user.id }).from(user).limit(1);
    if (existingShop || existingUser)
      throw conflict(
        "This simulation database already contains records. Use a fresh target; previous runs are preserved.",
      );
    const owner: OwnerPrincipal = {
      kind: "owner",
      userId: randomUUID(),
      sellerId: randomUUID(),
    };
    await tx
      .insert(user)
      .values({
        id: owner.userId,
        name: "Simulation owner",
        email: "simulation-owner@example.test",
      });
    await tx
      .insert(seller)
      .values({
        ...snapshot.shop,
        id: owner.sellerId,
        ownerUserId: owner.userId,
        contactEmail: "simulation-contact@example.test",
        allowedOrigins: [],
      });
    const ids = new Map(
      snapshot.products.map((p) => [p.sourceId, randomUUID()]),
    );
    let assetId: string | null = null;
    if (snapshot.products.some((p) => p.kind === "digital")) {
      assetId = randomUUID();
      const bytes = Buffer.from(
        "SELLER DESK SIMULATION\nThis is a fictional download for a private test. No purchase was made and this is not the seller's actual product file.\n",
      );
      await tx
        .insert(digitalAsset)
        .values({
          id: assetId,
          sellerId: owner.sellerId,
          filename: "simulation-download.txt",
          mimeType: "text/plain",
          sizeBytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes,
        });
    }
    for (const { sourceId, available, ...product } of snapshot.products) {
      const id = ids.get(sourceId)!;
      await tx
        .insert(offer)
        .values({
          ...product,
          id,
          sellerId: owner.sellerId,
          published: true,
          digitalAssetId: product.kind === "digital" ? assetId : null,
        });
      if (product.kind === "goods")
        await tx
          .insert(inventory)
          .values({ offerId: id, total: available!, held: 0, sold: 0 });
    }
    for (const {
      sourceId: _sourceId,
      productId,
      validUntil,
      ...guide
    } of snapshot.guides) {
      await tx
        .insert(shopGuide)
        .values({
          ...guide,
          sellerId: owner.sellerId,
          published: true,
          productId: productId ? ids.get(productId)! : null,
          validUntil: validUntil ? new Date(validUntil) : null,
        });
    }
    for (const item of snapshot.procedures) {
      const id = randomUUID();
      await tx
        .insert(assistantProcedure)
        .values({
          id,
          sellerId: owner.sellerId,
          revision: item.revision,
          publishedRevision: item.revision,
          content: item.content,
        });
      await tx
        .insert(assistantProcedureVersion)
        .values({
          procedureId: id,
          sellerId: owner.sellerId,
          revision: item.revision,
          content: item.content,
        });
    }
    return { owner, offerIds: ids };
  });
}
