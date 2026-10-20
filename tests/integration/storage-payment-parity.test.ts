import { getDb } from "@/server/db/client";
import type { PaymentEvidence } from "@/server/db/types";
import { createD1Db } from "@/server/storage/d1/client";
import { createD1PaymentStorage } from "@/server/storage/d1/payments";
import type {
  PaidCommitInput,
  PaymentStorage,
} from "@/server/storage/payments";
import { createPostgresPaymentStorage } from "@/server/storage/postgres/payments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: real atomic payment outcomes`, () => {
    let f: StorageFixture, p: PaymentStorage;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
      p = f.binding
        ? createD1PaymentStorage(createD1Db(f.binding))
        : createPostgresPaymentStorage(getDb());
    });
    afterEach(async () => {
      await f?.close();
    });
    async function pending(
      kinds: ("goods" | "service" | "digital")[] = ["goods"],
    ) {
      const q = await f.makeQuote(kinds),
        id = await f.checkout.holdAndRecord(
          f.buyer,
          { quoteId: q.id, revision: 1 },
          {
            environment: "fixture",
            payeeMerchantId: "FIXTURE-MERCHANT",
            appUrl: "http://localhost:4310",
          },
        );
      const attempt = (await p.acquireLease(id, ["planned"]))!;
      expect(attempt).toBeTruthy();
      const providerOrderId = `FIXTURE-${crypto.randomUUID()}`,
        captureId = `CAPTURE-${crypto.randomUUID()}`;
      await p.fencedPatch(attempt, {
        providerOrderId,
        state: "capture_in_flight",
      });
      const evidence: PaymentEvidence = {
        observedAt: new Date().toISOString(),
        environment: "fixture",
        providerOrderId,
        orderStatus: "COMPLETED",
        captureId,
        captureStatus: "COMPLETED",
        amountValue: (attempt.amountMinor / 100).toFixed(2),
        currency: "USD",
        payeeMerchantId: "FIXTURE-MERCHANT",
        referenceId: q.id,
        checks: [
          {
            name: "storage acceptance evidence; no provider request",
            passed: true,
          },
        ],
      };
      const commit: PaidCommitInput = {
        attemptId: id,
        expectedFence: attempt.fence,
        captureId,
        evidence,
        payer: { name: null, email: null },
      };
      return { attempt, commit, q };
    }
    const count = async (table: string) =>
      Number((await f.query(`select count(*) n from ${table}`))[0]!.n);
    it("records a mixed paid order, stock and all obligations once under simultaneous replays", async () => {
      const { commit } = await pending(["goods", "service", "digital"]);
      const results = await Promise.all([
        p.recordPaidOrder(commit),
        p.recordPaidOrder(commit),
        p.recordPaidOrder(commit),
      ]);
      expect(results.filter((row) => row.created)).toHaveLength(1);
      expect(new Set(results.map((row) => row.orderId)).size).toBe(1);
      expect(results[0]!.orderNumber).toBe(1001);
      expect(await count("orders")).toBe(1);
      expect(await count("fulfillment_task")).toBe(4);
      expect(await count("job")).toBe(1);
      expect(
        (
          await f.query("select held,sold from inventory where offer_id=?", [
            f.goodsId,
          ])
        )[0],
      ).toEqual({ held: 0, sold: 1 });
      expect(
        (await f.query("select state from payment_attempt"))[0]!.state,
      ).toBe("paid");
      expect((await f.query("select state from reservation"))[0]!.state).toBe(
        "captured",
      );
      expect(
        Number(
          (
            await f.query(
              "select count(*) n from audit_event where operation='payment.paid'",
            )
          )[0]!.n,
        ),
      ).toBe(1);
      expect(
        Number(
          (
            await f.query(
              "select count(*) n from operation_key where scope='d1-batch-guard'",
            )
          )[0]!.n,
        ),
      ).toBe(0);
    });
    it("rejects replaced executors at final commit and prevents their patches, cancellation and dispatch", async () => {
      const { attempt, commit } = await pending();
      await f.query(
        "update payment_attempt set lease_expires_at=? where id=?",
        [new Date(Date.now() - 1000), attempt.id],
      );
      const replacement = (await p.acquireLease(attempt.id, [
        "capture_in_flight",
      ]))!;
      expect(replacement.fence).toBe(attempt.fence + 1);
      expect(
        await p.fencedPatch(attempt, { lastError: "must never persist" }),
      ).toBe(false);
      expect(
        await p.dispatchCapture(attempt, { state: "capture_in_flight" }),
      ).toBe(false);
      await p.closeAttempt(attempt, "cancelled", "old executor", "cancelled");
      await expect(p.recordPaidOrder(commit)).rejects.toThrow(/replaced/);
      expect(await count("orders")).toBe(0);
      expect((await f.query("select held,sold from inventory"))[0]).toEqual({
        held: 1,
        sold: 0,
      });
      const paid = await p.recordPaidOrder({
        ...commit,
        expectedFence: replacement.fence,
      });
      expect(paid.created).toBe(true);
      await p.closeAttempt(
        replacement,
        "cancelled",
        "must not close paid",
        "cancelled",
      );
      expect(
        (await f.query("select state from payment_attempt"))[0]!.state,
      ).toBe("paid");
    });
    it("rolls back a failed paid audit, then retries without selling or creating obligations twice", async () => {
      const { commit } = await pending(["goods", "digital"]);
      if (dialect === "postgres") {
        await f.query(
          "create or replace function reject_paid_audit() returns trigger language plpgsql as $$ begin if NEW.operation='payment.paid' then raise exception 'injected paid audit failure'; end if; return NEW; end $$",
        );
        await f.query(
          "create trigger fail_paid_audit before insert on audit_event for each row execute function reject_paid_audit()",
        );
      } else
        await f.query(
          "create trigger fail_paid_audit before insert on audit_event when NEW.operation='payment.paid' begin select raise(abort,'injected paid audit failure'); end",
        );
      try {
        await expect(p.recordPaidOrder(commit)).rejects.toThrow();
        expect(await count("orders")).toBe(0);
        expect(await count("fulfillment_task")).toBe(0);
        expect(await count("job")).toBe(0);
        expect((await f.query("select held,sold from inventory"))[0]).toEqual({
          held: 1,
          sold: 0,
        });
        expect((await f.query("select state from reservation"))[0]!.state).toBe(
          "held",
        );
      } finally {
        await f.query(
          dialect === "postgres"
            ? "drop trigger fail_paid_audit on audit_event"
            : "drop trigger fail_paid_audit",
        );
      }
      const paid = await p.recordPaidOrder(commit);
      expect(paid.created).toBe(true);
      expect((await p.recordPaidOrder(commit)).created).toBe(false);
      expect(await count("orders")).toBe(1);
      expect(await count("fulfillment_task")).toBe(2);
      expect((await f.query("select held,sold from inventory"))[0]).toEqual({
        held: 0,
        sold: 1,
      });
    });
    it("records a late verified capture as paid with stock attention when released stock is unavailable", async () => {
      const { attempt, commit } = await pending();
      await p.closeAttempt(
        attempt,
        "cancelled",
        "approval window expired",
        "expired",
      );
      await f.query("update inventory set total=0 where offer_id=?", [
        f.goodsId,
      ]);
      const paid = await p.recordPaidOrder(commit);
      expect(paid.created).toBe(true);
      expect(
        (
          await f.query("select state from fulfillment_task where order_id=?", [
            paid.orderId,
          ])
        )[0]!.state,
      ).toBe("attention");
      expect((await f.query("select held,sold from inventory"))[0]).toEqual({
        held: 0,
        sold: 0,
      });
      expect(
        (await f.query("select state from payment_attempt"))[0]!.state,
      ).toBe("paid");
    });
    it("cancels and releases a hold once, even when cancellation is retried", async () => {
      const { attempt } = await pending();
      await p.closeAttempt(
        attempt,
        "cancelled",
        "buyer_cancelled",
        "cancelled",
      );
      await p.closeAttempt(
        attempt,
        "cancelled",
        "buyer_cancelled",
        "cancelled",
      );
      expect((await f.query("select held,sold from inventory"))[0]).toEqual({
        held: 0,
        sold: 0,
      });
      expect((await f.query("select state from reservation"))[0]!.state).toBe(
        "released",
      );
      expect(await count("orders")).toBe(0);
    });
  });
