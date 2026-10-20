import { createDb } from "@/server/db/client";
import type { PolicySnapshot, QuoteLine } from "@/server/db/types";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import type { CheckoutStorage } from "@/server/storage/checkout";
import { createD1CheckoutStorage } from "@/server/storage/d1/checkout";
import type { D1Binding } from "@/server/storage/d1/client";
import { createPostgresCheckoutStorage } from "@/server/storage/postgres/checkout";
import { Pool } from "pg";
import { newD1TestDatabase } from "./d1";
import { TEST_DATABASE_URL } from "./test-env";

type Scalar = string | number | boolean | Date | Uint8Array | null;
/** Both fixtures execute real storage operations and inspect committed native rows. */
export type StorageFixture = {
  dialect: "postgres" | "d1";
  checkout: CheckoutStorage;
  query: (sql: string, values?: Scalar[]) => Promise<Record<string, unknown>[]>;
  buyer: BuyerPrincipal;
  owner: OwnerPrincipal;
  goodsId: string;
  serviceId: string;
  digitalId: string;
  assetId: string;
  policy: PolicySnapshot;
  makeQuote: (
    kinds?: ("goods" | "service" | "digital")[],
  ) => Promise<{ id: string; revision: number; lines: QuoteLine[] }>;
  close: () => Promise<void>;
  binding?: D1Binding;
};

/** SQL parameter syntax is adapted only in this test fixture, never in application storage. */
export async function newStorageFixture(
  dialect: StorageFixture["dialect"],
): Promise<StorageFixture> {
  const pg = dialect === "postgres" ? createDb(TEST_DATABASE_URL) : null;
  const local = dialect === "d1" ? await newD1TestDatabase() : null;
  const inspect = pg
    ? new Pool({ connectionString: TEST_DATABASE_URL, max: 2 })
    : null;
  const query: StorageFixture["query"] = async (source, values = []) => {
    if (inspect) {
      let number = 0;
      return (
        await inspect.query(
          source.replace(/\?/g, () => `$${++number}`),
          values,
        )
      ).rows;
    }
    return (
      await local!.binding
        .prepare(source)
        .bind(
          ...values.map((value) =>
            value instanceof Date
              ? value.getTime()
              : typeof value === "boolean"
                ? Number(value)
                : value,
          ),
        )
        .all()
    ).results;
  };
  try {
    const owner: OwnerPrincipal = {
      kind: "owner",
      userId: crypto.randomUUID(),
      sellerId: crypto.randomUUID(),
    };
    const buyer: BuyerPrincipal = {
      kind: "buyer",
      sellerId: owner.sellerId,
      buyerSessionId: crypto.randomUUID(),
    };
    const goodsId = crypto.randomUUID(),
      serviceId = crypto.randomUUID(),
      digitalId = crypto.randomUUID(),
      assetId = crypto.randomUUID();
    // Tests use one shop per fixture. The singleton is an installation invariant.
    if (pg) {
      if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test"))
        throw new Error("Test database required.");
      const tables = await query(
        "select tablename from pg_tables where schemaname='public' and tablename<>'installation'",
      );
      await query(
        `truncate ${tables.map((row) => '"' + String(row.tablename).replaceAll('"', '""') + '"').join(",")} restart identity cascade`,
      );
    }
    const now = new Date();
    await query(
      'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      [
        owner.userId,
        "Acceptance owner",
        `${owner.userId}@example.test`,
        true,
        now,
        now,
      ],
    );
    await query(
      "INSERT INTO seller(id,owner_user_id,display_name,contact_email,country,currency,pickup_policy,service_request_policy,digital_access_policy,tax_policy) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        owner.sellerId,
        owner.userId,
        "Acceptance shop",
        "seller@example.test",
        "CA",
        "USD",
        "Pickup at the shop.",
        "Seller confirms timing after payment.",
        "Download for 30 days.",
        "Tax included.",
      ],
    );
    await query(
      "INSERT INTO buyer_session(id,seller_id,entry,expires_at) VALUES (?,?,?,?)",
      [
        buyer.buyerSessionId,
        owner.sellerId,
        "page",
        new Date(Date.now() + 3600_000),
      ],
    );
    await query(
      "INSERT INTO digital_asset(id,seller_id,filename,mime_type,size_bytes,sha256,bytes) VALUES (?,?,?,?,?,?,?)",
      [
        assetId,
        owner.sellerId,
        "guide.txt",
        "text/plain",
        4,
        "test-only",
        Buffer.from("test"),
      ],
    );
    for (const [id, kind, amount] of [
      [goodsId, "goods", 3500],
      [serviceId, "service", 4000],
      [digitalId, "digital", 2500],
    ] as const) {
      await query(
        "INSERT INTO offer(id,seller_id,kind,published,title,description,unit_amount_minor,currency,service_scope,digital_asset_id,access_days) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          owner.sellerId,
          kind,
          true,
          kind,
          "Acceptance product",
          amount,
          "USD",
          kind === "service" ? "Fixed work" : null,
          kind === "digital" ? assetId : null,
          kind === "digital" ? 30 : null,
        ],
      );
    }
    await query("INSERT INTO inventory(offer_id,total) VALUES (?,?)", [
      goodsId,
      2,
    ]);
    const policy: PolicySnapshot = {
      policyRevision: 1,
      sellerName: "Acceptance shop",
      pickupPolicy: "Pickup at the shop.",
      serviceRequestPolicy: "Seller confirms timing after payment.",
      digitalAccessPolicy: "Download for 30 days.",
      cancellationPolicy: null,
      taxPolicy: "Tax included.",
    };
    return {
      dialect,
      query,
      owner,
      buyer,
      goodsId,
      serviceId,
      digitalId,
      assetId,
      policy,
      checkout: pg
        ? createPostgresCheckoutStorage(pg.db)
        : createD1CheckoutStorage(local!.db),
      binding: local?.binding,
      async makeQuote(kinds = ["goods"]) {
        const id = crypto.randomUUID();
        const lines: QuoteLine[] = kinds.map((kind) => ({
          offerId:
            kind === "goods"
              ? goodsId
              : kind === "service"
                ? serviceId
                : digitalId,
          offerRevision: 1,
          kind,
          title: kind,
          quantity: 1,
          unitAmountMinor:
            kind === "goods" ? 3500 : kind === "service" ? 4000 : 2500,
          lineTotalMinor:
            kind === "goods" ? 3500 : kind === "service" ? 4000 : 2500,
          fulfillmentNote: "",
          serviceScope: kind === "service" ? "Fixed work" : null,
          accessDays: kind === "digital" ? 30 : null,
        }));
        const total = lines.reduce(
          (sum, line) => sum + (line.lineTotalMinor ?? 0),
          0,
        );
        await query(
          "INSERT INTO quote(id,thread_id,revision,seller_id,buyer_session_id,status,lines,charges,policy_snapshot,subtotal_minor,total_minor,currency,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            crypto.randomUUID(),
            1,
            owner.sellerId,
            buyer.buyerSessionId,
            "review_ready",
            JSON.stringify(lines),
            "[]",
            JSON.stringify(policy),
            total,
            total,
            "USD",
            new Date(Date.now() + 1800_000),
          ],
        );
        if (kinds.includes("digital"))
          await query(
            "INSERT INTO digital_quote_line(quote_id,offer_id,asset_id,access_days) VALUES (?,?,?,?)",
            [id, digitalId, assetId, 30],
          );
        return { id, revision: 1, lines };
      },
      async close() {
        if (inspect) await inspect.end();
        if (pg) await pg.pool.end();
        if (local) await local.close();
      },
    };
  } catch (error) {
    if (inspect) await inspect.end();
    if (pg) await pg.pool.end();
    if (local) await local.close();
    throw error;
  }
}
