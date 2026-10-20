import type { PaymentEvidence } from "@/server/db/types";
import { recordPaidOrder } from "@/server/payments/paid";
import { afterEach, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";

let f: StorageFixture;
afterEach(async () => {
  await f?.close();
});
it("a payment executor replaced before its final commit cannot create an order or sell stock", async () => {
  f = await newStorageFixture("postgres");
  const quote = await f.makeQuote();
  const id = await f.checkout.holdAndRecord(
    f.buyer,
    { quoteId: quote.id, revision: 1 },
    {
      environment: "fixture",
      payeeMerchantId: "FIXTURE-MERCHANT",
      appUrl: "http://localhost:4310",
    },
  );
  await f.query(
    "update payment_attempt set fence=2,lease_owner='replacement',lease_expires_at=?,provider_order_id='FIXTURE-ORDER' where id=?",
    [new Date(Date.now() + 30_000), id],
  );
  const evidence: PaymentEvidence = {
    observedAt: new Date().toISOString(),
    environment: "fixture",
    providerOrderId: "FIXTURE-ORDER",
    orderStatus: "COMPLETED",
    captureId: "FIXTURE-CAPTURE",
    captureStatus: "COMPLETED",
    amountValue: "35.00",
    currency: "USD",
    payeeMerchantId: "FIXTURE-MERCHANT",
    referenceId: quote.id,
    checks: [{ name: "test capture evidence", passed: true }],
  };
  const stale = {
    attemptId: id,
    expectedFence: 1,
    captureId: "FIXTURE-CAPTURE",
    evidence,
    payer: { name: null, email: null },
  };
  await expect(recordPaidOrder(stale)).rejects.toThrow(/replaced|lease|fence/i);
  expect(Number((await f.query("select count(*) n from orders"))[0]!.n)).toBe(
    0,
  );
  expect(
    (
      await f.query("select held,sold from inventory where offer_id=?", [
        f.goodsId,
      ])
    )[0],
  ).toEqual({ held: 1, sold: 0 });
});
