/** Regression for customer replies copying knowledge-record metadata from tool results. */
import { convertToModelMessages, type ToolSet, type UIMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { buyerTools } from "@/server/ai/buyer-tools";
import { shopGuideTools } from "@/server/ai/shop-guide-tools";
import { getSeller } from "@/server/domain/seller";
import { saveGuide } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, offerId, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const options = { toolCallId: "read", messages: [], context: {} };
const fact = { title: "Bicycle parking", topic: "general" as const, body: "Free bicycle parking is in the covered rack beside the blue door.", published: true, actionLabel: "", actionUrl: "", productId: null, validUntil: null };

async function modelValue(tools: ToolSet, name: string, input: unknown, output: unknown) {
  const messages: UIMessage[] = [{ id: "saved-tool-evidence", role: "assistant", parts: [
    { type: "dynamic-tool", toolName: name, toolCallId: "read", state: "output-available", input, output },
  ] }];
  const converted = await convertToModelMessages(messages, { tools });
  const message = converted.find(item => item.role === "tool");
  const part = message?.content.find(item => item.type === "tool-result");
  if (!part || part.type !== "tool-result" || part.output.type !== "json") throw new Error("Expected a JSON tool result");
  return part.output.value;
}

describe("shop knowledge for model answers", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });

  it("keeps source evidence intact but removes unnecessary record metadata from resumed model context", async () => {
    const buyer = await newBuyer();
    const entry = await saveGuide(owner, fact);
    const tools = shopGuideTools(buyer);
    const before = await tally();
    const output = await tools.read_shop_guide.execute!({ productId: null }, options);
    expect(output).toMatchObject({ sources: [expect.objectContaining({ id: entry.id, revision: 1, body: fact.body })] });
    const value = await modelValue(tools, "read_shop_guide", {}, output);
    expect(value).toEqual({ sources: [{ title: fact.title, topic: fact.topic, body: fact.body, hasNextStep: false, productId: null, validUntil: null }] });
    expect(JSON.stringify(value)).not.toContain(entry.id);
    expect(output).toMatchObject({ sources: [expect.objectContaining({ id: entry.id, revision: 1 })] });
    expect(await tally()).toEqual(before);
  });

  it("keeps product scope, expiry, and exact approved action handles usable", async () => {
    const buyer = await newBuyer();
    const productId = await offerId("Disc brake");
    const validUntil = new Date(Date.now() + 86_400_000).toISOString();
    const entry = await saveGuide(owner, { ...fact, productId, validUntil, actionLabel: "Read pickup directions", actionUrl: "https://example.com/pickup" });
    const tools = shopGuideTools(buyer);
    const output = await tools.read_shop_guide.execute!({ productId }, options);
    expect(await modelValue(tools, "read_shop_guide", { productId }, output)).toEqual({ sources: [{ id: entry.id, revision: 1, title: fact.title, topic: fact.topic, body: fact.body, productId, validUntil, hasNextStep: true }] });
    expect(await tools.show_shop_step.execute!({ sourceId: entry.id, revision: 1 }, options)).toMatchObject({ step: { id: entry.id, revision: 1, host: "example.com" } });
  });

  it("projects catalog knowledge too without losing offer handles or payment-relevant facts", async () => {
    const buyer = await newBuyer();
    const shop = await getSeller();
    if (!shop) throw new Error("Missing shop");
    const entry = await saveGuide(owner, fact);
    const tools = buyerTools(buyer, shop);
    const input = { request: "brake pads", maxPriceMinor: null, kind: "goods" as const };
    const output = await tools.browse_catalog.execute!(input, options);
    if (!("offers" in output)) throw new Error("Expected a completed catalog result");
    const value = await modelValue(tools, "browse_catalog", input, output);
    expect(value).toMatchObject({ offers: output.offers, taxPolicy: output.taxPolicy, totalPublished: output.totalPublished });
    expect(JSON.stringify(value)).not.toContain(entry.id);
    expect(JSON.stringify(value)).not.toContain('"updatedAt"');
    expect(output.sources[0]?.id).toBe(entry.id);
  });

  it("preserves errors and empty results instead of inventing a successful answer", async () => {
    const buyer = await newBuyer();
    const tools = shopGuideTools(buyer);
    const input = { productId: crypto.randomUUID() };
    const failure = await tools.read_shop_guide.execute!(input, options);
    expect(failure).toHaveProperty("error");
    expect(await modelValue(tools, "read_shop_guide", input, failure)).toEqual(failure);
    const empty = await tools.read_shop_guide.execute!({ productId: null }, options);
    expect(await modelValue(tools, "read_shop_guide", {}, empty)).toEqual({ sources: [] });
  });
});
