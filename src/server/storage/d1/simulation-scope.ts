import { FIXTURE_MERCHANT_ID } from "@/fixtures/paypal-fixture";
import {
  installation,
  seller,
  storageIdentity,
} from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getServerConfig } from "@/server/env";
import { withSimulationScope } from "@/server/request-scope";
import { and, eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { createD1Db, type D1Binding, type D1Db } from "./client";
import { createD1FixtureTransport } from "./fixture-paypal";

/** Creates or reads a durable random identity; a second binding alias cannot masquerade as another database. */
export async function readD1Identity(db: D1Db): Promise<string> {
  await db
    .insert(storageIdentity)
    .values({ singleton: 1, id: crypto.randomUUID() })
    .onConflictDoNothing();
  const [row] = await db.select().from(storageIdentity);
  if (!row) throw new Error("D1 installation identity is missing.");
  return row.id;
}
/** Uses only an operator-supplied native binding, with independent signing secrets and fictional payments. */
export async function withD1Simulation<T>(
  source: D1Db,
  owner: OwnerPrincipal,
  binding: D1Binding,
  operation: () => Promise<T>,
): Promise<T> {
  const [shop] = await source
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  if (!shop) throw notFound("shop");
  const target = createD1Db(binding),
    sourceId = await readD1Identity(source);
  const [existingIdentity] = await target.select().from(storageIdentity);
  if (sourceId === existingIdentity?.id)
    throw new Error(
      "The simulation database must differ from the shop database.",
    );
  const rows = await target.select().from(installation);
  if (rows.length !== 1 || rows[0]?.environment !== "fixture")
    throw new Error(
      "Simulation requires an explicitly installed fixture database.",
    );
  // Only an independently identified, explicitly fictional target may receive metadata.
  const targetId = existingIdentity?.id ?? (await readD1Identity(target));
  if (sourceId === targetId)
    throw new Error(
      "The simulation database must differ from the shop database.",
    );
  const base = getServerConfig(),
    config = {
      ...base,
      mode: "fixture" as const,
      databaseKind: "d1" as const,
      databaseUrl: null,
      authSecret: createHmac("sha256", base.authSecret)
        .update(`seller-desk-simulation-auth:${targetId}`)
        .digest("hex"),
      jobsSecret: createHmac("sha256", base.jobsSecret)
        .update(`seller-desk-simulation-jobs:${targetId}`)
        .digest("hex"),
      paypal: { status: "fixture" as const },
      store: null,
    };
  return withSimulationScope(
    {
      d1: target,
      simulation: { config },
      paypal: {
        ok: true,
        payeeMerchantId: FIXTURE_MERCHANT_ID,
        transport: createD1FixtureTransport(target, {
          appUrl: config.appUrl,
          secret: config.jobsSecret,
        }),
      },
    },
    operation,
  );
}
