/** @fileoverview Model facts must distinguish payment, unfinished work and the absence of customer acceptance. */
import { convertToModelMessages, type UIMessage } from "ai";
import { beforeEach, expect, it } from "vitest";
import { buyerState, buyerTools } from "@/server/ai/buyer-tools";
import { listBuyerPurchases } from "@/server/domain/buyer-purchases";
import { getSeller } from "@/server/domain/seller";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop } from "../support/shop";

beforeEach(async () => { await resetShop(); });
it("keeps complete purchase evidence while explaining record limits plainly to live and resumed models", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const checkout = await checkoutFor(buyer, "Brake check"); await approveAtPayPal(checkout); await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  const output = await listBuyerPurchases(buyer);
  const original = JSON.stringify(output);
  const messages: UIMessage[] = [{ id: "tool-evidence", role: "assistant", parts: [{ type: "tool-my_orders", toolCallId: "read", state: "output-available", input: {}, output }] }];
  const converted = await convertToModelMessages(messages, { tools });
  const toolMessage = converted.find(m => m.role === "tool");
  const result = toolMessage?.content.find(p => p.type === "tool-result");
  if (!result || result.type !== "tool-result" || result.output.type !== "json") throw new Error("Missing facts");
  const facts = result.output.value;
  expect(facts).toMatchObject({ recordLimits: { customerAcceptance: "No customer acceptance or satisfaction is recorded. Payment does not establish either.", appointmentDateTime: "No exact appointment date or time is shared in these records." } });
  expect(JSON.stringify(facts)).not.toContain("not_collected");
  expect(JSON.stringify(facts)).not.toContain("not_shared");
  expect(facts).toMatchObject({ orders: [{ paymentId: checkout.attemptId, stillToDo: expect.any(Array) }] });
  expect(JSON.stringify(output)).toBe(original);
  expect(await buyerState(buyer)).toContain("No customer acceptance or satisfaction is recorded");
  expect(await tools.my_orders.toModelOutput!({ toolCallId: "read", input: {}, output })).toEqual({ type: "json", value: facts });
});

it("requires a fresh read for older saved purchase evidence instead of inventing absent help state", async () => {
  const buyer = await newBuyer(), tools = buyerTools(buyer, (await getSeller())!);
  const checkout = await checkoutFor(buyer, "Disc brake"); await approveAtPayPal(checkout); await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  const output = await listBuyerPurchases(buyer);
  const historical = { ...output, orders: output.orders.map(({ help: _help, ...row }) => row) };
  const original = JSON.stringify(historical);
  const messages: UIMessage[] = [{ id: "old-evidence", role: "assistant", parts: [{ type: "tool-my_orders", toolCallId: "old-read", state: "output-available", input: {}, output: historical }] }];
  const converted = await convertToModelMessages(messages, { tools });
  const toolMessage = converted.find(m => m.role === "tool");
  const result = toolMessage?.content.find(p => p.type === "tool-result");
  expect(result).toMatchObject({ output: { type: "json", value: { error: expect.stringContaining("my_orders") } } });
  expect(JSON.stringify(historical)).toBe(original);
});
