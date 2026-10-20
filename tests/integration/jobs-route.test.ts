/** Hosted recovery must authenticate before work and honor request cancellation. */
import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/jobs/reconcile/route";
import { approveAtPayPal, attemptRow, checkoutFor, makeDue, newBuyer, resetShop, tally } from "../support/shop";
import { TEST_ENV } from "../support/test-env";

beforeEach(resetShop);

async function duePurchase() {
  const payment = await checkoutFor(await newBuyer(), "Disc brake pads");
  await approveAtPayPal(payment);
  await makeDue(payment.attemptId);
  return payment;
}

function request(method: "GET" | "POST", secret?: string, signal?: AbortSignal) {
  return new Request("http://localhost:4310/api/jobs/reconcile", {
    method, signal, headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

describe("hosted recovery entry", () => {
  it("refuses missing and invalid credentials before processing a payment", async () => {
    const payment = await duePurchase();
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", "invalid-secret"))).status).toBe(401);
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
    expect((await attemptRow(payment.attemptId)).state).toBe("order_created");
  });

  it("passes authenticated request cancellation through without capturing", async () => {
    const payment = await duePurchase();
    const response = await POST(request("POST", TEST_ENV.JOBS_SECRET, AbortSignal.abort()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ stoppedBecause: "cancelled", paymentsChecked: 0 });
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
    expect((await attemptRow(payment.attemptId)).state).toBe("order_created");
  });

  it("permits authenticated scheduled GET and records one capture and order", async () => {
    await duePurchase();
    const response = await GET(request("GET", TEST_ENV.JOBS_SECRET));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ stoppedBecause: "batch_finished", paymentsChecked: 1, problems: [] });
    expect(await tally()).toMatchObject({ captures: 1, orders: 1 });
  });
});
