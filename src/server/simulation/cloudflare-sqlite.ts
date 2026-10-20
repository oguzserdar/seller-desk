/** Private per-trial SQLite Durable Object. There is no public route to this SQL endpoint. */
import type { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import { createTrialBinding, decodeTrialValue, encodeTrialValue, type TrialQuery, type TrialRows } from "./sqlite-binding";
import type { TrialDatabaseFactory } from "./trial-database";
import { isBatchGuardFailure } from "@/server/storage/d1/errors";
import { DomainError } from "@/server/domain/errors";

/** One randomly named isolated database per trial side; never receives a binding to the live shop. */
export class SimulationDatabase {
  constructor(private readonly ctx: DurableObjectState) {}
  /** Accepts trusted internal prepared statements only. Batches commit or roll back together. */
  async fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = await request.json() as { queries: TrialQuery[]; atomic: boolean };
    if (!Array.isArray(body.queries) || body.queries.length > 64) return new Response(null, { status: 400 });
    // A crashed caller cannot leave unlimited abandoned trial storage behind.
    await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
    const execute = () => body.queries.map(query => {
      const cursor = this.ctx.storage.sql.exec(query.sql, ...query.values.map(decodeTrialValue));
      const rows = [...cursor.raw()].map(row => row.map(encodeTrialValue));
      const meta = this.ctx.storage.sql.exec<{ changes: number; id: number }>("SELECT changes() AS changes, last_insert_rowid() AS id").one();
      return { columns: cursor.columnNames, rows, changes: cursor.rowsWritten ? meta.changes : 0, lastRowId: meta.id };
    });
    try {
      const results = body.atomic ? this.ctx.storage.transactionSync(execute) : execute();
      return Response.json(results);
    } catch (error) {
      // Preserve only the known optimistic-guard category, never SQL values or raw database errors.
      return Response.json({ error: isBatchGuardFailure(error) ? "guard" : "storage" }, { status: 422 });
    }
  }
  /** Removes only this abandoned fictional shop; owner reports live in the source database. */
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

/** Allocates through a Worker binding, never an account token or browser-supplied destination. */
export function cloudflareTrialFactory(namespace: DurableObjectNamespace): TrialDatabaseFactory {
  // Shared across both sides in this request. Leave room below the Free plan's
  // 1,000 internal subrequests for source-shop auth, usage and report writes.
  let requests = 0;
  return async () => {
    const stub = namespace.get(namespace.newUniqueId());
    return {
      binding: createTrialBinding(async (queries, atomic) => {
        if (++requests > 750) throw new DomainError("unavailable", "This test reached its storage limit. Try a shorter conversation.");
        const response = await stub.fetch("https://trial.internal/queries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries, atomic }) });
        if (!response.ok) {
          const failure = await response.json() as { error?: string };
          throw new Error(failure.error === "guard" ? "CHECK constraint failed: operation_key_state_valid" : "Isolated trial storage is unavailable.");
        }
        return await response.json() as TrialRows[];
      }),
      close: async () => { await stub.fetch("https://trial.internal/queries", { method: "DELETE" }); },
    };
  };
}
