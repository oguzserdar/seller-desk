import { fixtureFault } from "@/server/db/sqlite/schema";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";

/** Consumes one explicit simulator fault atomically; this never generates an AI reply. */
export async function takeD1Fault(db: D1Db, name: string): Promise<boolean> {
  return (
    (
      await db
        .update(fixtureFault)
        .set({ remaining: sql`${fixtureFault.remaining}-1` })
        .where(
          and(eq(fixtureFault.name, name), sql`${fixtureFault.remaining}>0`),
        )
        .returning({ name: fixtureFault.name })
    ).length > 0
  );
}

/** Consumes the independent evidence-tampering controls together in one native query. */
export async function takeD1EvidenceFaults(db: D1Db): Promise<Set<string>> {
  const rows = await db
    .update(fixtureFault)
    .set({ remaining: sql`${fixtureFault.remaining}-1` })
    .where(
      and(
        sql`${fixtureFault.name} in ('evidence_wrong_amount','evidence_wrong_payee')`,
        sql`${fixtureFault.remaining}>0`,
      ),
    )
    .returning({ name: fixtureFault.name });
  return new Set(rows.map((row) => row.name));
}
/** A decline takes priority; only the next applicable capture control is consumed. */
export async function takeD1CaptureFault(
  db: D1Db,
): Promise<string | undefined> {
  const next = db
    .select({ name: fixtureFault.name })
    .from(fixtureFault)
    .where(
      and(
        sql`${fixtureFault.name} in ('capture_declined','capture_pending')`,
        sql`${fixtureFault.remaining}>0`,
      ),
    )
    .orderBy(
      sql`case ${fixtureFault.name} when 'capture_declined' then 0 else 1 end`,
    )
    .limit(1);
  const [row] = await db
    .update(fixtureFault)
    .set({ remaining: sql`${fixtureFault.remaining}-1` })
    .where(eq(fixtureFault.name, sql`(${next})`))
    .returning({ name: fixtureFault.name });
  return row?.name;
}
