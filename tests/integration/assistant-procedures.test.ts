/** Procedure approval, scope and version behavior against real PostgreSQL, with no simulated AI answers. */
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { PROCEDURE_LIMIT, type ProcedureContent } from "@/lib/assistant-procedure";
import { getDb } from "@/server/db/client";
import { assistantProcedure, assistantProcedureVersion, buyerSession } from "@/server/db/schema";
import { listProcedures, pauseProcedure, procedureHistory, publishProcedure, publishedProceduresForBuyer, restoreProcedure, saveProcedure } from "@/server/domain/assistant-procedures";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const A: ProcedureContent = { title: "Unclear repair requests", whenToUse: "The customer is unsure which repair they need.", steps: "Ask what problem they noticed before suggesting a repair. Do not claim to diagnose the bicycle or confirm an appointment. Ask the seller if scope or timing is unclear." };
const B: ProcedureContent = { ...A, steps: "Ask whether the problem affects the front brake, rear brake or both. Keep the customer's stated budget. Ask the seller to confirm the work before proposing payment." };
const create = () => saveProcedure(owner, { id: crypto.randomUUID(), expectedRevision: 0, content: A });
beforeEach(async () => { ({ owner } = await resetShop()); });

it("keeps drafts private, uses only the approved version, and preserves live text while another draft is edited", async () => {
  const buyer = await newBuyer(), before = await tally();
  const first = await create(); expect(await publishedProceduresForBuyer(buyer)).toEqual([]);
  await publishProcedure(owner, { id: first.id, expectedRevision: 1, approve: true });
  expect(await publishedProceduresForBuyer(buyer)).toEqual([A]);
  const edit = await saveProcedure(owner, { id: first.id, expectedRevision: 1, content: B });
  expect(edit).toMatchObject({ revision: 2, publishedRevision: 1, content: B });
  expect(await publishedProceduresForBuyer(buyer)).toEqual([A]);
  await expect(publishProcedure(owner, { id: first.id, expectedRevision: 1, approve: true })).rejects.toMatchObject({ code: "conflict" });
  await publishProcedure(owner, { id: first.id, expectedRevision: 2, approve: true });
  expect(await publishedProceduresForBuyer(buyer)).toEqual([B]); expect(await tally()).toEqual(before);
});

it("reuses exact save/publication retries without duplicate versions or approvals", async () => {
  const input = { id: crypto.randomUUID(), expectedRevision: 0, content: A };
  const saved = await saveProcedure(owner, input); expect(await saveProcedure(owner, input)).toEqual(saved);
  await saveProcedure(owner, { id: saved.id, expectedRevision: 1, content: B });
  await saveProcedure(owner, { id: saved.id, expectedRevision: 1, content: B });
  const approval = { id: saved.id, expectedRevision: 2, approve: true as const };
  const live = await publishProcedure(owner, approval); expect(await publishProcedure(owner, approval)).toEqual(live);
  expect(await procedureHistory(owner, saved.id)).toHaveLength(2);
  const { rows } = await getDb().execute(sql`select count(*)::int as n from audit_event where operation = 'assistant_procedure.publish'`);
  expect(rows[0]?.n).toBe(1);
});

it("requires owner identity, trusted shop scope and target ownership for every read or write", async () => {
  const row = await create();
  for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
    await expect(listProcedures(caller, true)).rejects.toMatchObject({ code: "not_found" });
    await expect(procedureHistory(caller, row.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(saveProcedure(caller, { id: row.id, expectedRevision: 1, content: B })).rejects.toMatchObject({ code: "not_found" });
    await expect(publishProcedure(caller, { id: row.id, expectedRevision: 1, approve: true })).rejects.toMatchObject({ code: "not_found" });
    await expect(pauseProcedure(caller, row.id, 1)).rejects.toMatchObject({ code: "not_found" });
    await expect(restoreProcedure(caller, row.id, 1, 1)).rejects.toMatchObject({ code: "not_found" });
  }
  expect((await listProcedures(owner))[0]).toEqual(row);
});

it("restores history as a new draft without switching or destroying the live version", async () => {
  const buyer = await newBuyer(), row = await create();
  await saveProcedure(owner, { id: row.id, expectedRevision: 1, content: B });
  await publishProcedure(owner, { id: row.id, expectedRevision: 2, approve: true });
  const restored = await restoreProcedure(owner, row.id, 2, 1);
  expect(restored).toMatchObject({ revision: 3, publishedRevision: 2, content: A });
  expect(await publishedProceduresForBuyer(buyer)).toEqual([B]);
  await publishProcedure(owner, { id: row.id, expectedRevision: 3, approve: true });
  expect(await publishedProceduresForBuyer(buyer)).toEqual([A]);
  expect((await procedureHistory(owner, row.id)).map(v => [v.revision, v.content])).toEqual([[3, A], [2, B], [1, A]]);
});

it("keeps the live wording inspectable when it falls outside the latest hundred drafts", async () => {
  const row = await create();
  await publishProcedure(owner, { id: row.id, expectedRevision: 1, approve: true });
  for (let revision = 2; revision <= 102; revision++) {
    await saveProcedure(owner, { id: row.id, expectedRevision: revision - 1, content: { ...B, title: `Repair directions ${revision}` } });
  }
  const versions = await procedureHistory(owner, row.id);
  expect(versions).toHaveLength(101);
  expect(versions[0]?.revision).toBe(102);
  expect(versions.at(-1)).toMatchObject({ revision: 1, content: A });
  expect(versions.some(v => v.revision === 2)).toBe(false);
});

it("pauses immediately on a fresh read and prevents stale approvals from reviving paused or archived instructions", async () => {
  const buyer = await newBuyer(), row = await create();
  await publishProcedure(owner, { id: row.id, expectedRevision: 1, approve: true });
  await pauseProcedure(owner, row.id, 1);
  expect(await publishedProceduresForBuyer(buyer)).toEqual([]);
  await expect(publishProcedure(owner, { id: row.id, expectedRevision: 1, approve: true })).rejects.toMatchObject({ code: "conflict" });
  await pauseProcedure(owner, row.id, 2, true); expect(await listProcedures(owner)).toEqual([]);
  await expect(publishProcedure(owner, { id: row.id, expectedRevision: 3, approve: true })).rejects.toMatchObject({ code: "conflict" });
  await restoreProcedure(owner, row.id, 3, 1); expect(await publishedProceduresForBuyer(buyer)).toEqual([]);
  expect((await listProcedures(owner))[0]).toMatchObject({ revision: 4, publishedRevision: null, archived: false });
});

it("serializes competing drafts and bounds concurrent new instructions", async () => {
  const row = await create();
  const edits = await Promise.allSettled([saveProcedure(owner, { id: row.id, expectedRevision: 1, content: B }), saveProcedure(owner, { id: row.id, expectedRevision: 1, content: { ...B, title: "Different change" } })]);
  expect(edits.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await procedureHistory(owner, row.id)).toHaveLength(2);
  for (let i = 1; i < PROCEDURE_LIMIT - 1; i++) await create();
  const additions = await Promise.allSettled([create(), create()]);
  expect(additions.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await listProcedures(owner)).toHaveLength(PROCEDURE_LIMIT);
});

it("rejects expired, revoked or mismatched buyer principals before reading live handling instructions", async () => {
  const buyer = await newBuyer(), row = await create();
  await publishProcedure(owner, { id: row.id, expectedRevision: 1, approve: true });
  await expect(publishedProceduresForBuyer({ ...buyer, sellerId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  await getDb().update(buyerSession).set({ revokedAt: new Date() }).where(eq(buyerSession.id, buyer.buyerSessionId));
  await expect(publishedProceduresForBuyer(buyer)).rejects.toMatchObject({ code: "not_found" });
  await getDb().update(buyerSession).set({ revokedAt: null, expiresAt: new Date(0) }).where(eq(buyerSession.id, buyer.buyerSessionId));
  await expect(publishedProceduresForBuyer(buyer)).rejects.toMatchObject({ code: "not_found" });
});

it("rolls back both draft and version when recording the audit fails", async () => {
  const row = await create();
  await getDb().execute(sql`create function reject_procedure_audit() returns trigger language plpgsql as $$ begin if NEW.operation like 'assistant_procedure.%' then raise exception 'audit unavailable'; end if; return NEW; end $$`);
  await getDb().execute(sql`create trigger procedure_audit_failure before insert on audit_event for each row execute function reject_procedure_audit()`);
  try { await expect(saveProcedure(owner, { id: row.id, expectedRevision: 1, content: B })).rejects.toThrow(); }
  finally { await getDb().execute(sql`drop trigger procedure_audit_failure on audit_event`); await getDb().execute(sql`drop function reject_procedure_audit()`); }
  expect((await getDb().select().from(assistantProcedure))[0]).toEqual(row);
  expect(await getDb().select().from(assistantProcedureVersion)).toHaveLength(1);
});
