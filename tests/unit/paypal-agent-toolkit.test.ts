import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { expect, it } from "vitest";
import { PAYPAL_READ_TOOLS, readOnlyPayPalTools } from "@/server/paypal/agent-toolkit";

const everything = {
  orders: { create: true, get: true, capture: true },
  invoices: { create: true, list: true, get: true, send: true, sendReminder: true, cancel: true, generateQRC: true },
  products: { create: true, list: true, show: true, update: true },
  subscriptionPlans: { create: true, list: true, show: true },
  subscriptions: { create: true, show: true, cancel: true },
  shipment: { create: true, show: true, cancel: true },
  disputes: { list: true, get: true, create: true },
  transactions: { list: true },
  refunds: { create: true, get: true },
};

it("gives the desk assistant only PayPal's read tools, even when the toolkit offers everything", () => {
  const toolkit = new PayPalAgentToolkit({ clientId: "test-id", clientSecret: "test-value", configuration: { actions: everything, context: { sandbox: true } } });
  const offered = toolkit.getTools();
  // Control: the toolkit really did offer tools that move money, so the filter has something to remove.
  expect(Object.keys(offered)).toEqual(expect.arrayContaining(["create_order", "create_invoice"]));
  const kept = readOnlyPayPalTools(offered as never);
  expect(Object.keys(kept).sort()).toEqual(PAYPAL_READ_TOOLS.map((name) => `paypal_${name}`).sort());
  expect(Object.keys(kept).some((name) => /create|pay|capture|refund|cancel|send|update/.test(name.replace(/^paypal_/, "")))).toBe(false);
});

it("rebuilds each tool with an input schema this app's AI SDK can read", () => {
  const toolkit = new PayPalAgentToolkit({ clientId: "test-id", clientSecret: "test-value", configuration: { actions: { orders: { get: true } }, context: { sandbox: true } } });
  const kept = readOnlyPayPalTools(toolkit.getTools() as never);
  const order = kept.paypal_get_order as { inputSchema?: unknown; description?: string };
  expect(order.inputSchema).toBeTruthy();
  expect(order.description).toContain("Read-only");
});

it("turns a PayPal failure into a plain message instead of an error the model could misread", async () => {
  const kept = readOnlyPayPalTools({ get_order: { description: "x", parameters: {}, execute: async () => { throw new Error("boom"); } } } as never);
  const run = (kept.paypal_get_order as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute;
  expect(await run({}, {})).toEqual({ error: "PayPal did not answer that. Try again in a minute." });
});
