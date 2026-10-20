import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getReadiness } from "@/server/domain/readiness";
import { getSeller } from "@/server/domain/seller";
import { resetServerConfigForTests } from "@/server/env";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop } from "../support/shop";

beforeEach(async () => { await resetShop(); });
afterEach(() => {
  process.env.APP_MODE = "fixture";
  for (const key of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MERCHANT_ID", "PAYPAL_WEBHOOK_ID"]) delete process.env[key];
  resetServerConfigForTests();
});

describe("PayPal readiness evidence", () => {
  it("labels untested keys configured, never Done or verified", async () => {
    process.env.APP_MODE = "sandbox";
    process.env.PAYPAL_CLIENT_ID = "arbitrary-client";
    process.env.PAYPAL_CLIENT_SECRET = "arbitrary-secret";
    process.env.PAYPAL_MERCHANT_ID = "arbitrary-merchant";
    process.env.PAYPAL_WEBHOOK_ID = "arbitrary-webhook";
    resetServerConfigForTests();
    const result = await getReadiness((await getSeller())!);
    expect(result.checks.find((check) => check.key === "paypal")).toMatchObject({ state: "configured", fix: { href: "/owner/setup#paypal" } });
    expect(result.checks.find((check) => check.key === "purchase")?.state).toBe("fail");
  });

  it("keeps a completed fixture purchase explicitly simulated", async () => {
    const buyer = await newBuyer();
    const payment = await checkoutFor(buyer, "Disc brake pads");
    await approveAtPayPal(payment);
    await reconcilePayment(buyer, payment.attemptId!, { mayCapture: true });
    const check = (await getReadiness((await getSeller())!)).checks.find((row) => row.key === "purchase");
    expect(check).toMatchObject({ state: "fixture" });
    expect(check?.detail).toContain("simulated");
    expect(check?.detail).not.toContain("verified");
  });
});
