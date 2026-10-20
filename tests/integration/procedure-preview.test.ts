/** Real PostgreSQL contracts; stored synthetic payloads never stand in for a model call. */
import { beforeEach, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { procedurePreview } from "@/server/db/schema";
import { claimProcedurePreview, failProcedurePreview, listProcedurePreviews, saveProcedurePreviewAnswer } from "@/server/domain/procedure-preview";
import { listProcedures, pauseProcedure, publishProcedure, saveProcedure } from "@/server/domain/assistant-procedures";
import { generatePreviewAnswer } from "@/server/ai/learning-preview";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const first = { title: "Urgent repairs", whenToUse: "A customer needs a repair urgently.", steps: "Keep the customer's deadline and budget. Ask the seller to confirm availability." };
const second = { ...first, steps: "Ask for the wheel diameter before taking the urgent repair request to the seller. Preserve the deadline and budget." };
const storedFixture = { text: "SYNTHETIC storage fixture only, not an AI reply.", latencyMs: 1, inputTokens: null, outputTokens: null, reads: ["read_shop_facts" as const] };
beforeEach(async () => { ({ owner } = await resetShop()); });
async function prepare() {
  const instruction = await saveProcedure(owner, { id: crypto.randomUUID(), expectedRevision: 0, content: first });
  await publishProcedure(owner, { id: instruction.id, expectedRevision: 1, approve: true });
  await saveProcedure(owner, { id: instruction.id, expectedRevision: 1, content: second });
  return { requestId: crypto.randomUUID(), procedureId: instruction.id, expectedRevision: 2, question: "I need a repair before Friday for less than $150. Where do I start?" };
}
it("pins live vs saved wording and public facts without changing published instructions or commerce", async () => {
  const input = await prepare(), before = await tally(), directions = await listProcedures(owner);
  const run = await claimProcedurePreview(owner, input, "storage-contract");
  expect(run.row.currentInstructions).toEqual([first]); expect(run.row.proposedInstructions).toEqual([second]);
  expect(run.row.facts.products.length).toBeGreaterThan(0);
  expect(run.row.facts).not.toHaveProperty("answer"); expect(run.row.facts).not.toHaveProperty("knownFacts");
  await saveProcedure(owner, { id: input.procedureId, expectedRevision: 2, content: { ...first, title: "Later change" } });
  const retry = await claimProcedurePreview(owner, input, "storage-contract");
  expect(retry.created).toBe(false); expect(retry.row).toEqual(run.row);
  expect((await listProcedures(owner))[0]?.publishedRevision).toBe(directions[0]?.publishedRevision); expect(await tally()).toEqual(before);
});
it("serializes identical claims and rejects changed retries or another concurrent comparison", async () => {
  const input = await prepare();
  const runs = await Promise.all([claimProcedurePreview(owner, input, "storage-contract"), claimProcedurePreview(owner, input, "storage-contract")]);
  expect(runs.filter(run => run.created)).toHaveLength(1);
  await expect(claimProcedurePreview(owner, { ...input, question: "Different question?" }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  await expect(claimProcedurePreview(owner, { ...input, requestId: crypto.randomUUID() }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
});
it("proves owner identity for creation, result saving, failure and saved reports", async () => {
  const input = await prepare(); await claimProcedurePreview(owner, input, "storage-contract");
  for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
    await expect(claimProcedurePreview(caller, input, "storage-contract")).rejects.toMatchObject({ code: "not_found" });
    await expect(saveProcedurePreviewAnswer(caller, input.requestId, "current", storedFixture)).rejects.toMatchObject({ code: "not_found" });
    await expect(failProcedurePreview(caller, input.requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listProcedurePreviews(caller)).rejects.toMatchObject({ code: "not_found" });
  }
});
it("retains partial replies after failure and cannot overwrite a saved result", async () => {
  const input = await prepare(); await claimProcedurePreview(owner, input, "storage-contract");
  await expect(saveProcedurePreviewAnswer(owner, input.requestId, "proposed", storedFixture)).rejects.toMatchObject({ code: "conflict" });
  await saveProcedurePreviewAnswer(owner, input.requestId, "current", storedFixture); await failProcedurePreview(owner, input.requestId);
  const [view] = await listProcedurePreviews(owner);
  expect(view).toMatchObject({ state: "failed", current: storedFixture, proposed: null });expect(view).not.toHaveProperty("facts");
  await expect(saveProcedurePreviewAnswer(owner, input.requestId, "proposed", storedFixture)).rejects.toMatchObject({ code: "conflict" });
});
it("needs two ordered nonempty replies and preserves a completed comparison", async () => {
  const input = await prepare(); await claimProcedurePreview(owner, input, "storage-contract");
  await expect(saveProcedurePreviewAnswer(owner, input.requestId, "current", { ...storedFixture, text: " " })).rejects.toThrow();
  await saveProcedurePreviewAnswer(owner, input.requestId, "current", storedFixture);
  await expect(saveProcedurePreviewAnswer(owner, input.requestId, "current", storedFixture)).rejects.toMatchObject({ code: "conflict" });
  await saveProcedurePreviewAnswer(owner, input.requestId, "proposed", storedFixture); await failProcedurePreview(owner, input.requestId);
  expect((await listProcedurePreviews(owner))[0]?.state).toBe("completed");
});
it("keeps interrupted evidence and permits a new run after expiry", async () => {
  const input = await prepare(); await claimProcedurePreview(owner, input, "storage-contract");
  await getDb().update(procedurePreview).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(procedurePreview.id, input.requestId));
  expect((await listProcedurePreviews(owner))[0]?.state).toBe("failed");
  expect((await getDb().select().from(procedurePreview))[0]?.state).toBe("running");
  await expect(saveProcedurePreviewAnswer(owner, input.requestId, "current", storedFixture)).rejects.toMatchObject({ code: "conflict" });
  expect((await claimProcedurePreview(owner, { ...input, requestId: crypto.randomUUID() }, "storage-contract")).created).toBe(true);
  expect((await getDb().select().from(procedurePreview).where(eq(procedurePreview.id, input.requestId)))[0]?.state).toBe("failed");
});
it("rejects unseen, stale and archived instructions before creating a report", async () => {
  const input = await prepare();
  await expect(claimProcedurePreview(owner, { ...input, procedureId: crypto.randomUUID() }, "storage-contract")).rejects.toMatchObject({ code: "not_found" });
  await expect(claimProcedurePreview(owner, { ...input, expectedRevision: 1 }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  await pauseProcedure(owner, input.procedureId, 2, true);
  await expect(claimProcedurePreview(owner, { ...input, expectedRevision: 3 }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  expect(await listProcedurePreviews(owner)).toEqual([]);
});
it("sends the proposed handling preference with read-only tools and no successful stand-in response", async () => {
  const input = await prepare(), run = await claimProcedurePreview(owner, input, "capture-only");
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("Deliberate provider refusal after request capture"); } });
  await expect(generatePreviewAnswer(model, run.row.facts, input.question, run.row.proposedInstructions)).rejects.toThrow("Deliberate provider refusal");
  const request = model.doGenerateCalls[0]!;
  expect(request.tools?.map(t => t.name)).toEqual(["read_shop_facts"]);
  expect(JSON.stringify(request.prompt)).toContain("wheel diameter");
  expect(JSON.stringify(request.prompt)).toContain("You have no action tools");
  expect((await listProcedurePreviews(owner))[0]?.current).toBe(null);
});
