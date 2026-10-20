import {
  armFault,
  decideFixtureOrder,
  FIXTURE_SIGNATURE_HEADER,
  settleFixtureCapture,
  signFixtureWebhook,
  type FixtureFaultName,
} from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { proposeQuote } from "@/server/domain/quotes";
import { runDueWork } from "@/server/jobs/run";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { ingestWebhook } from "@/server/payments/webhooks";
import { withD1Database } from "@/server/request-scope";
import { getStorage } from "@/server/storage";
import { createD1Db, type D1Binding } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";
import { TEST_ENV } from "../support/test-env";
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: provider failure and durable recovery`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    const run = <T>(work: () => Promise<T>) =>
      f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    async function fault(name: FixtureFaultName, times = 1) {
      await run(async () => {
        const s = getStorage();
        if (s.kind === "d1") await s.fixture.armFault(name, times);
        else await armFault(getDb(), name, times);
      });
    }
    async function checkout() {
      const q = await run(() =>
        proposeQuote(f.buyer, { lines: [{ offerId: f.goodsId, quantity: 1 }] }),
      );
      return run(() => startCheckout(f.buyer, { quoteId: q.id, revision: 1 }));
    }
    async function approve(id: string) {
      await run(async () => {
        const s = getStorage();
        if (s.kind === "d1") await s.fixture.decideFixtureOrder(id, "approve");
        else await decideFixtureOrder(getDb(), id, "approve");
      });
    }
    const count = async (table: string) =>
      Number((await f.query(`select count(*) n from ${table}`))[0]!.n);
    it("a signed approval webhook captures only after provider approval; duplicates do not repeat effects", async () => {
      const c = await checkout(),
        id = c.approvalUrl!.split("/").at(-1)!;
      await approve(id);
      const raw = JSON.stringify({
          id: crypto.randomUUID(),
          event_type: "CHECKOUT.ORDER.APPROVED",
          resource: { id },
        }),
        headers = new Headers({
          [FIXTURE_SIGNATURE_HEADER]: signFixtureWebhook(
            raw,
            TEST_ENV.JOBS_SECRET!,
          ),
        });
      expect((await run(() => ingestWebhook(headers, raw))).status).toBe(200);
      expect((await run(() => ingestWebhook(headers, raw))).duplicate).toBe(
        true,
      );
      expect(await count("orders")).toBe(1);
      expect(await count("webhook_event")).toBe(1);
      expect(
        (await f.query("select processing_state from webhook_event"))[0]!
          .processing_state,
      ).toBe("processed");
      expect((await run(() => ingestWebhook(new Headers(), raw))).status).toBe(
        401,
      );
      expect(await count("orders")).toBe(1);
    });
    it.each(["evidence_wrong_amount", "evidence_wrong_payee"] as const)(
      "does not fulfill a capture with %s",
      async (name) => {
        const c = await checkout();
        await approve(c.approvalUrl!.split("/").at(-1)!);
        await fault(name, name === "evidence_wrong_amount" ? 2 : 1);
        const result = await run(() =>
          reconcilePayment(f.buyer, c.attemptId, { mayCapture: true }),
        );
        expect(result.state).toBe("verification_pending");
        expect(await count("orders")).toBe(0);
        expect(await count("fulfillment_task")).toBe(0);
      },
    );
    it("keeps an instrument decline unpaid and allows a later explicit retry", async () => {
      const c = await checkout();
      await approve(c.approvalUrl!.split("/").at(-1)!);
      await fault("capture_declined");
      const first = await run(() =>
        reconcilePayment(f.buyer, c.attemptId, { mayCapture: true }),
      );
      expect(first.state).toBe("order_created");
      expect(first.headline).toMatch(/declined/i);
      expect(await count("orders")).toBe(0);
      expect((await f.query("select held,sold from inventory"))[0]).toEqual({
        held: 1,
        sold: 0,
      });
      expect(
        (
          await run(() =>
            reconcilePayment(f.buyer, c.attemptId, { mayCapture: true }),
          )
        ).state,
      ).toBe("paid");
      expect(await count("orders")).toBe(1);
    });

    it("retains pending capture state and later records the provider's completed capture once", async () => {
      const c = await checkout(),
        id = c.approvalUrl!.split("/").at(-1)!;
      await approve(id);
      await fault("capture_pending");
      expect(
        (
          await run(() =>
            reconcilePayment(f.buyer, c.attemptId, { mayCapture: true }),
          )
        ).state,
      ).toBe("verification_pending");
      expect(await count("orders")).toBe(0);
      await run(async () => {
        const s = getStorage();
        if (s.kind === "d1")
          await s.fixture.settleFixtureCapture(id, "COMPLETED");
        else await settleFixtureCapture(getDb(), id, "COMPLETED");
      });
      expect(
        (
          await run(() =>
            reconcilePayment(f.buyer, c.attemptId, { mayCapture: true }),
          )
        ).state,
      ).toBe("paid");
      expect(await count("orders")).toBe(1);
    });
    it("background work recovers a lost create response from durable records", async () => {
      await fault("create_lost_before_effect");
      const c = await checkout();
      expect(c.state).toBe("create_in_flight");
      await f.query("update payment_attempt set next_check_at=? where id=?", [
        new Date(Date.now() - 1000),
        c.attemptId,
      ]);
      const summary = await run(() => runDueWork("test"));
      expect(summary.problems).toEqual([]);
      expect(
        (await f.query("select state from payment_attempt"))[0]!.state,
      ).toBe("order_created");
      expect(await count("fixture_provider_order")).toBe(1);
    });
  });

it.each(["goods", "digital"] as const)(
  "a 10-line D1 %s cart stays within a bounded native query allowance",
  async (kind) => {
    const f = await newStorageFixture("d1");
    let queries = 0;
    const binding = new Proxy(f.binding!, {
      get(target, key) {
        if (key === "prepare")
          return (...args: Parameters<D1Binding["prepare"]>) => {
            queries++;
            return target.prepare(...args);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const run = <T>(work: () => Promise<T>) =>
      withD1Database(createD1Db(binding), work);
    try {
      const ids = [kind === "goods" ? f.goodsId : f.digitalId];
      for (let i = 1; i < 10; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        let asset: string | null = null;
        if (kind === "digital") {
          asset = crypto.randomUUID();
          await f.query(
            "insert into digital_asset(id,seller_id,filename,mime_type,size_bytes,sha256,bytes) values(?,?,?,?,?,?,?)",
            [
              asset,
              f.owner.sellerId,
              `file-${i}.txt`,
              "text/plain",
              4,
              "test",
              Buffer.from("test"),
            ],
          );
        }
        await f.query(
          "insert into offer(id,seller_id,kind,published,title,description,unit_amount_minor,currency,digital_asset_id,access_days) values(?,?,?,?,?,?,?,?,?,?)",
          [
            id,
            f.owner.sellerId,
            kind,
            true,
            `Product ${i}`,
            "Acceptance product",
            1000,
            "USD",
            asset,
            kind === "digital" ? 30 : null,
          ],
        );
        if (kind === "goods")
          await f.query("insert into inventory(offer_id,total) values(?,?)", [
            id,
            2,
          ]);
      }
      const quote = await run(() =>
        proposeQuote(f.buyer, {
          lines: ids.map((offerId) => ({ offerId, quantity: 1 })),
        }),
      );
      queries = 0;
      const checkout = await run(() =>
        startCheckout(f.buyer, { quoteId: quote.id, revision: 1 }),
      );
      expect(queries).toBeLessThanOrEqual(35);
      await run(() =>
        getStorage().kind === "d1"
          ? (
              getStorage() as Extract<
                ReturnType<typeof getStorage>,
                { kind: "d1" }
              >
            ).fixture.decideFixtureOrder(
              checkout.approvalUrl!.split("/").at(-1)!,
              "approve",
            )
          : Promise.reject(),
      );
      queries = 0;
      expect(
        (
          await run(() =>
            reconcilePayment(f.buyer, checkout.attemptId, { mayCapture: true }),
          )
        ).state,
      ).toBe("paid");
      expect(queries).toBeLessThanOrEqual(45);
      expect(
        Number((await f.query("select count(*) n from orders"))[0]!.n),
      ).toBe(1);
      if (kind === "digital")
        expect(
          Number((await f.query("select count(*) n from access_grant"))[0]!.n),
        ).toBe(10);
    } finally {
      await f.close();
    }
  },
);
