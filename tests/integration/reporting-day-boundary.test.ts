import type { PaymentEvidence } from "@/server/db/types";
import { readPaidSummary } from "@/server/domain/paid-summary";
import { recordPaidOrder } from "@/server/payments/paid";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";
let f: StorageFixture;
afterEach(async () => {
  await f?.close();
});
it.each(["postgres", "d1"] as const)(
  "%s includes the first repeated midnight hour in the seller's calendar-day paid total",
  async (kind) => {
    f = await newStorageFixture(kind);
    const q = await f.makeQuote();
    const id = await f.checkout.holdAndRecord(
      f.buyer,
      { quoteId: q.id, revision: 1 },
      {
        environment: "fixture",
        payeeMerchantId: "FIXTURE-MERCHANT",
        appUrl: "http://localhost:4310",
      },
    );
    await f.query(
      "update payment_attempt set provider_order_id='FIXTURE-REPEATED-MIDNIGHT',fence=1 where id=?",
      [id],
    );
    const evidence: PaymentEvidence = {
      observedAt: "2026-11-01T04:30:00.000Z",
      environment: "fixture",
      providerOrderId: "FIXTURE-REPEATED-MIDNIGHT",
      orderStatus: "COMPLETED",
      captureId: "FIXTURE-REPEATED-MIDNIGHT-CAPTURE",
      captureStatus: "COMPLETED",
      amountValue: "35.00",
      currency: "USD",
      payeeMerchantId: "FIXTURE-MERCHANT",
      referenceId: q.id,
      checks: [],
    };
    const run = <T>(fn: () => Promise<T>) =>
      f.dialect === "d1" ? withD1Database(createD1Db(f.binding!), fn) : fn();
    await run(() =>
      recordPaidOrder({
        attemptId: id,
        expectedFence: 1,
        captureId: evidence.captureId!,
        evidence,
        payer: { name: null, email: null },
      }),
    );
    const summary = await run(() =>
      readPaidSummary(
        f.owner,
        { period: "today", timeZone: "America/Havana" },
        new Date("2026-11-01T14:00:00Z"),
      ),
    );
    expect(summary.totals).toMatchObject([
      { currency: "USD", paidOrders: 1, paidMinor: 3500 },
    ]);
  },
);
