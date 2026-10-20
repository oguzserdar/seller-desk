/** A new customer turn starts from the shop's records: the first model step must call a tool. */
import { beforeEach, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { buyerAgent } from "@/server/ai/buyer-agent";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { getSeller } from "@/server/domain/seller";
import { newBuyer, resetShop } from "../support/shop";

beforeEach(async () => { await resetShop(); });

async function firstCall(options?: { requireFirstTool?: boolean }) {
  const buyer = await newBuyer(), id = await ensureConversation(buyer);
  const assistantTurn = (await claimTurn(buyer, id))!;
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("Deliberate refusal after input capture"); } });
  const agent = buyerAgent(model, { ...buyer, assistantTurn }, (await getSeller())!, "No purchase yet.", "", options);
  await expect(agent.generate({ prompt: "How do I find your entrance?" })).rejects.toThrow("Deliberate refusal");
  return model.doGenerateCalls[0]!;
}

it("requires a tool on the first step of a new turn, so a reply cannot be made up from nothing (real 14 Oct run)", async () => {
  expect((await firstCall()).toolChoice).toEqual({ type: "required" });
});

it("lets a turn that resumes from the owner's saved answer reply without another lookup", async () => {
  expect((await firstCall({ requireFirstTool: false })).toolChoice).not.toEqual({ type: "required" });
});
