import { seedShop } from "@/fixtures/seed";
import { getOwnerOrder } from "@/server/domain/orders";
import { proposeQuote } from "@/server/domain/quotes";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { withD1Database } from "@/server/request-scope";
import { getStorage } from "@/server/storage";
import { createD1Db } from "@/server/storage/d1/client";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { openD1Maintenance } from "../../scripts/lib/d1-maintenance";
import {
  applyD1Migrations,
  type D1MigrationTarget,
} from "../../scripts/lib/d1-runner";

function sqliteFiles(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const file = path.join(dir, e.name);
        return e.isDirectory()
          ? sqliteFiles(file)
          : file.endsWith(".sqlite")
            ? [file]
            : [];
      })
    : [];
}
function state<T>(dir: string, read: (db: DatabaseSync) => T): T {
  const files = sqliteFiles(dir).filter((file) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return (
        db
          .prepare("select name from sqlite_master where name='d1_migrations'")
          .all().length === 1
      );
    } finally {
      db.close();
    }
  });
  expect(files).toHaveLength(1);
  const db = new DatabaseSync(files[0]!, { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

it("official Wrangler migrations and native maintenance preserve a populated Seller Desk across upgrade and restart", async () => {
  const root = mkdtempSync(
      path.join(tmpdir(), "seller-desk-application-upgrade-"),
    ),
    persistTo = path.join(root, "state"),
    target: D1MigrationTarget = {
      mode: "local",
      databaseId: "00000000-0000-0000-0000-000000000002",
      persistTo,
    };
  let connection: Awaited<ReturnType<typeof openD1Maintenance>> | undefined;
  try {
    const files = readdirSync("drizzle-d1")
      .filter((n) => n.endsWith(".sql"))
      .sort();
    for (const file of files.slice(0, 2))
      writeFileSync(
        path.join(root, file),
        readFileSync(path.join("drizzle-d1", file)),
      );
    await applyD1Migrations(root, target);
    connection = await openD1Maintenance(target);
    await connection.binding
      .prepare("insert into installation(environment) values ('fixture')")
      .run();
    const seeded = await withD1Database(createD1Db(connection.binding), () =>
      seedShop({
        preset: "showcase",
        origins: [],
        fixturePassword: "application-upgrade-fixture-password",
      }),
    );
    if (seeded.outcome !== "seeded")
      throw new Error("fresh target was occupied");
    const { owner } = seeded;
    let orderId = "";
    await withD1Database(createD1Db(connection.binding), async () => {
      const s = getStorage();
      if (s.kind !== "d1") throw Error("native binding required");
      const issued = await s.sessions.startBuyerSession("page"),
        buyer = await s.sessions.resolveBuyer(issued.token),
        offers = await s.catalog.listPublishedOffers(owner.sellerId),
        product = offers.find((o) => o.kind === "goods")!;
      const q = await proposeQuote(buyer, {
          lines: [{ offerId: product.id, quantity: 1 }],
        }),
        c = await startCheckout(buyer, { quoteId: q.id, revision: 1 });
      await s.fixture.decideFixtureOrder(
        c.approvalUrl!.split("/").at(-1)!,
        "approve",
      );
      const paid = await reconcilePayment(buyer, c.attemptId, {
        mayCapture: true,
      });
      orderId = paid.order!.id;
    });
    await connection.close();
    connection = undefined;
    const digest = () =>
      state(persistTo, (db) =>
        Object.fromEntries(
          [
            "user",
            "account",
            "seller",
            "offer",
            "inventory",
            "digital_asset",
            "buyer_session",
            "buyer_capability",
            "quote",
            "digital_quote_line",
            "payment_attempt",
            "orders",
            "reservation",
            "fulfillment_task",
            "job",
            "audit_event",
            "fixture_provider_order",
            "storage_sequence",
          ].map((table) => {
            const rows = db
              .prepare(`select * from "${table}" order by 1`)
              .all();
            return [
              table,
              createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
            ];
          }),
        ),
      );
    const before = digest();
    for (const file of files.slice(2))
      writeFileSync(
        path.join(root, file),
        readFileSync(path.join("drizzle-d1", file)),
      );
    await applyD1Migrations(root, target);
    expect(digest()).toEqual(before);
    state(persistTo, (db) => {
      expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
      expect(
        db.prepare("select name from d1_migrations order by id").all(),
      ).toEqual(files.map((name) => ({ name })));
    });
    connection = await openD1Maintenance(target);
    const order = await withD1Database(createD1Db(connection.binding), () =>
      getOwnerOrder(owner, orderId),
    );
    expect(order.order.number).toBe(1001);
    expect(order.attempt.state).toBe("paid");
    await connection.close();
    connection = undefined;
    await applyD1Migrations(root, target);
    expect(digest()).toEqual(before);
  } finally {
    await connection?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);
