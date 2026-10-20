/** Recovery cancellation uses real PostgreSQL and simulated payments, never a live PayPal account. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDueWork } from "@/server/jobs/run";
import { getPayPal, setTransportForTests } from "@/server/paypal";
import { TransportUncertainError } from "@/server/paypal/types";
import { approveAtPayPal, attemptRow, checkoutFor, makeDue, newBuyer, resetShop, tally } from "../support/shop";

beforeEach(resetShop);
afterEach(() => setTransportForTests(null));

async function duePurchase() {
  const buyer = await newBuyer();
  const payment = await checkoutFor(buyer, "Disc brake pads");
  await approveAtPayPal(payment);
  await makeDue(payment.attemptId);
  return payment;
}
function transport() {
  const found = getPayPal();
  if (!found.ok) throw new Error("Fixture is not ready");
  return found.transport;
}

describe("bounded recovery passes", () => {
  it("does not start any payment after its caller already cancelled", async () => {
    const payment = await duePurchase();
    const summary = await runDueWork("test", { signal: AbortSignal.abort() });
    expect(summary.stoppedBecause).toBe("cancelled");
    expect(summary.paymentsChecked).toBe(0);
    expect((await attemptRow(payment.attemptId)).state).toBe("order_created");
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
  });

  it("aborts a slow provider read and leaves the next payment untouched", async () => {
    const first = await duePurchase();
    const second = await duePurchase();
    const base = transport();
    let reads = 0;
    setTransportForTests({ ...base, async getOrder(id, signal) {
      reads += 1;
      if (!signal) return base.getOrder(id);
      await new Promise<void>((_, reject) => {
        const stop = () => reject(new TransportUncertainError("Recovery deadline", "aborted"));
        if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
      });
      throw new Error("Unreachable");
    } });
    const started = performance.now();
    const summary = await runDueWork("test", { budgetMs: 500 });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(summary.stoppedBecause).toBe("time_budget");
    expect(summary.paymentsChecked).toBe(1);
    expect(reads).toBe(1);
    expect((await attemptRow(first.attemptId)).uncertainSince).not.toBeNull();
    expect((await attemptRow(second.attemptId)).uncertainSince).toBeNull();
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
  });

  it("keeps a capture uncertain when the deadline interrupts its response, then recovers exactly once", async () => {
    const payment = await duePurchase();
    const base = transport();
    const controller = new AbortController();
    setTransportForTests({ ...base,
      async getOrder(id, signal) {
        if (signal?.aborted) throw new TransportUncertainError("Recovery stopped", "aborted");
        return base.getOrder(id);
      },
      async captureOrder(id, requestId) {
        await base.captureOrder(id, requestId);
        controller.abort();
        throw new TransportUncertainError("Capture response interrupted", "aborted");
      },
    });
    const interrupted = await runDueWork("test", { signal: controller.signal });
    expect(interrupted.stoppedBecause).toBe("cancelled");
    expect(await tally()).toMatchObject({ captures: 1, orders: 0 });
    expect(await attemptRow(payment.attemptId)).toMatchObject({ state: "capture_in_flight", leaseOwner: null });
    const requestId = (await attemptRow(payment.attemptId)).captureRequestId;
    setTransportForTests(base);
    await makeDue(payment.attemptId);
    await runDueWork("test");
    expect(await attemptRow(payment.attemptId)).toMatchObject({ state: "paid", captureRequestId: requestId });
    expect(await tally()).toMatchObject({ captures: 1, orders: 1 });
  });
});
