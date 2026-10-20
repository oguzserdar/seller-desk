/** Reproduced native replies copied quote IDs/status codes and misattributed simulated payment evidence. */
import { convertToModelMessages, type ToolSet, type UIMessage } from "ai";
import { beforeEach, expect, it } from "vitest";
import { buyerState, buyerTools } from "@/server/ai/buyer-tools";
import { getSeller } from "@/server/domain/seller";
import { cancelCheckout, reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, offerId, resetShop, tally } from "../support/shop";

const options = { toolCallId: "commerce", messages: [], context: {} };
beforeEach(async () => { await resetShop(); });

async function replay(tools: ToolSet, name: string, input: unknown, output: unknown) {
  const saved: UIMessage[] = [{ id: "original", role: "assistant", parts: [
    { type: "dynamic-tool", toolName: name, toolCallId: "commerce", state: "output-available", input, output },
  ] }];
  const converted = await convertToModelMessages(saved, { tools });
  const result = converted.find(item => item.role === "tool")?.content.find(item => item.type === "tool-result");
  if (!result || result.type !== "tool-result" || result.output.type !== "json") throw new Error("Missing model evidence");
  return result.output.value;
}

it("gives live and resumed quote answers price/problems without unused quote identifiers", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const input = { mode: "replace" as const, lines: [{ offerId: await offerId("Disc brake"), quantity: 1 }], budgetMinor: null, deliveryRequested: false, buyerNote: null };
  const output = await tools.propose_quote.execute!(input, options);
  if (!("quoteId" in output)) throw new Error("Quote failed");
  const before = JSON.stringify(output);
  const value = await replay(tools, "propose_quote", input, output);
  expect(value).toMatchObject({ status: "Ready to pay", totalMinor: 3500, currency: "USD", lines: [{ title: "Disc brake pads", quantity: 1, lineTotalMinor: 3500 }], unresolved: [] });
  expect(JSON.stringify(value)).not.toContain(output.quoteId);
  expect(JSON.stringify(value)).not.toContain("review_ready");
  expect(value).not.toHaveProperty("revision");
  expect(JSON.stringify(output)).toBe(before);
  expect(await tools.propose_quote.toModelOutput!({ toolCallId: "commerce", input, output })).toEqual({ type: "json", value });
  const current = await buyerState(buyer);
  expect(current).toContain("Ready to pay");
  expect(current).not.toContain("review_ready");
});

it("preserves a failed quote as failure", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const input = { mode: "replace" as const, lines: [{ offerId: crypto.randomUUID(), quantity: 1 }], budgetMinor: null, deliveryRequested: false, buyerNote: null };
  const output = await tools.propose_quote.execute!(input, options);
  expect(output).toHaveProperty("error");
  expect(await replay(tools, "propose_quote", input, output)).toEqual(output);
  expect(await tally()).toMatchObject({ orders: 0, attempts: 0 });
});

it("distinguishes stored simulated payment evidence and retains only the customer order number in the check result", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const checkout = await checkoutFor(buyer, "Disc brake");
  await approveAtPayPal(checkout);
  await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  const before = await tally();
  const input = { paymentId: checkout.attemptId };
  const output = await tools.check_payment.execute!(input, options);
  expect(output).toMatchObject({ verified: true, checkType: "stored_record", environment: "fixture" });
  const value = await replay(tools, "check_payment", input, output);
  expect(value).toMatchObject({ paymentConfirmed: true, paymentEnvironment: "Simulated test payment; no real money", evidence: "Saved shop record. PayPal was not contacted during this check.", orderNumber: expect.any(Number) });
  expect(JSON.stringify(value)).not.toContain("stored_record");
  expect(value).not.toHaveProperty("state");
  expect(value).not.toHaveProperty("checkType");
  expect(output).toMatchObject({ verified: true, checkType: "stored_record", environment: "fixture" });
  expect(value).not.toHaveProperty("order.id");
  expect(await tally()).toEqual(before);
  const purchases = await tools.my_orders.execute!({}, options);
  if (!("orders" in purchases)) throw new Error("Missing purchase records");
  expect(purchases.orders[0]?.paymentId).toBe(checkout.attemptId);
});

it("keeps denied payment reads as errors without inventing confirmation evidence", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const input = { paymentId: crypto.randomUUID() };
  const output = await tools.check_payment.execute!(input, options);
  expect(output).toHaveProperty("error");
  expect(await replay(tools, "check_payment", input, output)).toEqual(output);
  expect(await tally()).toMatchObject({ orders: 0, attempts: 0 });
});

it("never presents pending reconciliation or a saved cancellation as payment confirmation", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const checkout = await checkoutFor(buyer, "Disc brake");
  const input = { paymentId: checkout.attemptId };
  const pending = await tools.check_payment.execute!(input, options);
  expect(pending).toMatchObject({ verified: false, checkType: "reconciliation_attempt" });
  const pendingFacts = await replay(tools, "check_payment", input, pending);
  expect(pendingFacts).toMatchObject({ paymentConfirmed: false, evidence: expect.stringContaining("not permission to start another payment") });
  await cancelCheckout(buyer, checkout.attemptId);
  const cancelled = await tools.check_payment.execute!(input, options);
  expect(cancelled).toMatchObject({ verified: false, checkType: "stored_record" });
  expect(await replay(tools, "check_payment", input, cancelled)).toMatchObject({ paymentConfirmed: false, evidence: "Saved shop record. PayPal was not contacted during this check." });
  expect(await tally()).toMatchObject({ captures: 0, orders: 0, attempts: 1 });
});
