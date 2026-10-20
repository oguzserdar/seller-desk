import {
  SIMULATION_RUN_TTL_MS,
  SimulationInput,
  SimulationSideResult,
  type SimulationChange,
} from "@/lib/simulation";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  assistantProcedure,
  auditEvent,
  seller,
  simulationRun,
} from "@/server/db/sqlite/schema";
import { conflict, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { sameSimulationInput, simulationView } from "@/server/simulation/runs";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { captureD1SimulationShop } from "./simulation-snapshot";
/** Private native simulation receipts preserve frozen sources and actual partial results. */
export function createD1SimulationRuns(db: D1Db) {
  async function owned(owner: OwnerPrincipal) {
    const [row] = await db
      .select({ ok: sql<number>`1` })
      .from(seller)
      .where(ownerScope(owner));
    if (!row) throw notFound("shop");
  }
  async function read(owner: OwnerPrincipal, id: string) {
    await owned(owner);
    const [row] = await db
      .select()
      .from(simulationRun)
      .where(
        and(
          eq(simulationRun.id, id),
          eq(simulationRun.sellerId, owner.sellerId),
        ),
      );
    return row;
  }
  return {
    async claimSimulation(
      owner: OwnerPrincipal,
      raw: SimulationInput,
      generator: string,
    ) {
      const input = SimulationInput.parse(raw);
      z.string().min(1).max(200).parse(generator);
      const prior = await read(owner, input.requestId);
      if (prior) return sameSimulationInput(prior, input);
      const snapshot = await captureD1SimulationShop(db, owner);
      let change: SimulationChange = null;
      if (input.change.kind === "instruction") {
        const [instruction] = await db
          .select()
          .from(assistantProcedure)
          .where(
            and(
              eq(assistantProcedure.id, input.change.id),
              eq(assistantProcedure.sellerId, owner.sellerId),
            ),
          );
        if (!instruction) throw notFound("instruction");
        if (
          instruction.archived ||
          instruction.revision !== input.change.revision
        )
          throw conflict(
            "The saved instruction changed. Reload it before starting a test.",
          );
        if (
          (snapshot.procedures.find((p) => p.sourceId === instruction.id)
            ?.revision ?? null) !== instruction.publishedRevision
        )
          throw conflict(
            "The published instruction changed while preparing the test. Start a new test.",
          );
        change = {
          id: instruction.id,
          revision: instruction.revision,
          publishedRevision: instruction.publishedRevision,
          content: instruction.content,
        };
      }
      const execution = crypto.randomUUID();
      try {
        const [, , , rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:owner`,
            sql`${ownerScope(owner)} and ${change ? sql`exists(select 1 from assistant_procedure where id=${change.id} and seller_id=${owner.sellerId} and archived=0 and revision=${change.revision} and published_revision is ${change.publishedRevision})` : sql`1`}`,
          ),
          db
            .update(simulationRun)
            .set({
              state: "failed",
              failure:
                "This test stopped before finishing. Earlier results are preserved.",
            })
            .where(
              and(
                eq(simulationRun.sellerId, owner.sellerId),
                eq(simulationRun.state, "running"),
                sql`${simulationRun.expiresAt}<=${nowMilliseconds}`,
              ),
            ),
          batchGuard(
            db,
            `${execution}:run`,
            sql`not exists(select 1 from simulation_run where seller_id=${owner.sellerId} and state='running') and not exists(select 1 from simulation_run where id=${input.requestId})`,
          ),
          db
            .insert(simulationRun)
            .values({
              id: input.requestId,
              sellerId: owner.sellerId,
              input,
              snapshot,
              change,
              generator,
              expiresAt: new Date(Date.now() + SIMULATION_RUN_TTL_MS),
            })
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "simulation.start",
              targetType: "simulation",
              targetId: input.requestId,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return { created: true, row: rows[0]! };
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const winner = await read(owner, input.requestId);
          if (winner) return sameSimulationInput(winner, input);
          throw conflict(
            "A shop test or instruction changed. Review it before starting another test.",
          );
        }
        throw error;
      }
    },
    async saveSimulationResult(
      owner: OwnerPrincipal,
      id: string,
      side: "current" | "proposed",
      raw: SimulationSideResult,
      finished = true,
    ) {
      z.uuid().parse(id);
      const result = SimulationSideResult.parse(raw),
        row = await read(owner, id);
      if (!row) throw notFound("test");
      if (row.state !== "running" || row.expiresAt <= new Date())
        throw conflict(
          "This test stopped or finished. Earlier results are preserved.",
        );
      if (
        side === "current"
          ? Boolean(row.currentResult)
          : !row.change || !row.currentResult || Boolean(row.proposedResult)
      )
        throw conflict(
          "This result was already saved or arrived out of order.",
        );
      const state = !finished
          ? "failed"
          : side === "current" && row.change
            ? "running"
            : "completed",
        execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:result`,
            sql`${ownerScope(owner)} and exists(select 1 from simulation_run where id=${id} and seller_id=${owner.sellerId} and state='running' and expires_at>${nowMilliseconds} and ${side === "current" ? sql`current_result is null` : sql`current_result is not null and proposed_result is null and change is not null`})`,
          ),
          db
            .update(simulationRun)
            .set({
              ...(side === "current"
                ? { currentResult: result }
                : { proposedResult: result }),
              state,
              failure: finished
                ? null
                : "The test stopped before finishing. Its actual partial transcript and records are preserved.",
            })
            .where(eq(simulationRun.id, id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "system",
              operation: "simulation.result",
              targetType: "simulation",
              targetId: id,
              outcome: finished ? "ok" : "failed",
              details: { side, finished },
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict("This result was already saved or the test expired.");
        throw error;
      }
    },
    async failSimulation(owner: OwnerPrincipal, id: string) {
      z.uuid().parse(id);
      const row = await read(owner, id);
      if (!row || row.state !== "running") return;
      const execution = crypto.randomUUID();
      await db.batch([
        batchGuard(db, `${execution}:owner`, ownerScope(owner)),
        db
          .update(simulationRun)
          .set({
            state: "failed",
            failure:
              "The test could not finish. Earlier results are saved. Check the connection before trying a new test.",
          })
          .where(
            and(
              eq(simulationRun.id, id),
              eq(simulationRun.sellerId, owner.sellerId),
              eq(simulationRun.state, "running"),
            ),
          ),
        db
          .insert(auditEvent)
          .values({
            actor: "system",
            operation: "simulation.failed",
            targetType: "simulation",
            targetId: id,
            outcome: "failed",
          }),
        clearBatchGuards(db, execution),
      ]);
    },
    async listSimulations(owner: OwnerPrincipal) {
      await owned(owner);
      return (
        await db
          .select()
          .from(simulationRun)
          .where(eq(simulationRun.sellerId, owner.sellerId))
          .orderBy(desc(simulationRun.createdAt), desc(simulationRun.id))
          .limit(20)
      ).map(simulationView);
    },
  };
}
