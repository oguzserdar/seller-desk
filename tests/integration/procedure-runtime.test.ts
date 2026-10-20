/** Captures actual SDK input then refuses generation; never supplies a successful AI reply. */
import { beforeEach, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { buyerAgent } from "@/server/ai/buyer-agent";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { getDb } from "@/server/db/client";
import { buyerSession } from "@/server/db/schema";
import { saveProcedure, publishProcedure, pauseProcedure } from "@/server/domain/assistant-procedures";
import { changeConversationHandler } from "@/server/domain/conversation-control";
import { getSeller } from "@/server/domain/seller";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const first = { title: "Urgent repairs", whenToUse: "A customer needs an urgent repair.", steps: "Ask for the wheel diameter before asking the seller to review an urgent repair. Retain the stated deadline without promising it." };
const second = { ...first, steps: "Ask for the bicycle frame material before asking the seller to review an urgent repair. Retain the stated deadline without promising it." };
beforeEach(async () => { ({ owner } = await resetShop()); });

async function setupAgent(guidance = "") {
  const buyer = await newBuyer(), id = await ensureConversation(buyer);
  const assistantTurn = (await claimTurn(buyer, id))!;
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("Deliberate provider refusal after input capture"); } });
  const agent = buyerAgent(model, { ...buyer, assistantTurn }, (await getSeller())!, "No purchase yet.", guidance);
  const capture = async () => {
    await expect(agent.generate({ prompt: "I need an urgent repair." })).rejects.toThrow("Deliberate provider refusal");
    return JSON.stringify(model.doGenerateCalls.at(-1)!.prompt);
  };
  return { buyer, id, model, agent, capture };
}

it("keeps private drafts out of model calls and rereads published wording on the same agent", async () => {
  const { capture } = await setupAgent(), before = await tally();
  const row = await saveProcedure(owner, { id: crypto.randomUUID(), expectedRevision: 0, content: first });
  expect(await capture()).not.toContain("wheel diameter");
  await publishProcedure(owner, { id: row.id, expectedRevision: 1, approve: true });
  expect(await capture()).toContain("wheel diameter");
  await saveProcedure(owner, { id: row.id, expectedRevision: 1, content: second });
  const draft = await capture(); expect(draft).toContain("wheel diameter"); expect(draft).not.toContain("frame material");
  await publishProcedure(owner, { id: row.id, expectedRevision: 2, approve: true });
  const published = await capture(); expect(published).toContain("frame material"); expect(published).not.toContain("wheel diameter");
  await pauseProcedure(owner, row.id, 2);
  expect(await capture()).not.toContain("frame material");
  expect(await tally()).toEqual(before);
});

it("retains base financial rules, continuation guidance and the same tools with owner directions", async () => {
  const { capture, model } = await setupAgent("\nContinue from the saved seller answer; it is not payment approval.");
  await capture(); const originalTools = model.doGenerateCalls.at(-1)!.tools;
  const row = await saveProcedure(owner, { id: crypto.randomUUID(), expectedRevision: 0, content: first });
  await publishProcedure(owner, { id: row.id, expectedRevision: 1, approve: true });
  const input = await capture();
  expect(input).toContain("wheel diameter");
  expect(input).toContain("cannot take payment, refund, change prices");
  expect(input).toContain("Continue from the saved seller answer");
  expect(model.doGenerateCalls.at(-1)!.tools).toEqual(originalTools);
});

it("does not send directions or start the model for a revoked buyer session", async () => {
  const { buyer, agent, model } = await setupAgent();
  await getDb().update(buyerSession).set({ revokedAt: new Date() }).where(eq(buyerSession.id, buyer.buyerSessionId));
  await expect(agent.generate({ prompt: "Urgent repair" })).rejects.toThrow();
  expect(model.doGenerateCalls).toHaveLength(0);
});

it("still prevents a model call after seller takeover", async () => {
  const { id, agent, model } = await setupAgent();
  await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
  await expect(agent.generate({ prompt: "Urgent repair" })).rejects.toThrow();
  expect(model.doGenerateCalls).toHaveLength(0);
});
