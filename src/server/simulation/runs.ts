/** Owner-scoped persistence for isolated simulations; never executes a model or publishes a change. */
import {
  SIMULATION_RUN_TTL_MS,
  SimulationInput,
  SimulationSideResult,
  type SimulationChange,
  type SimulationView,
} from "@/lib/simulation";
import { getDb, transaction, type Queryable } from "@/server/db/client";
import { assistantProcedure, seller, simulationRun } from "@/server/db/schema";
import { recordAudit } from "@/server/domain/audit";
import { conflict, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getStorage } from "@/server/storage";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { SimulationShopSnapshot } from "./snapshot";
import { captureSimulationShop } from "./snapshot";

/** Internal record includes frozen shop facts; send simulationView to a browser instead. */
export type SimulationRunRow = typeof simulationRun.$inferSelect;

/** Produces independent copies for both sides; no later draft or live-shop edit can enter a trial. */
export function simulationSnapshotForSide(
  row: SimulationRunRow,
  side: "current" | "proposed",
): SimulationShopSnapshot {
  const snapshot = structuredClone(row.snapshot);
  if (side === "current") return snapshot;
  if (!row.change)
    throw conflict("This test has no proposed change to compare.");
  const replacement = {
    sourceId: row.change.id,
    revision: row.change.revision,
    content: structuredClone(row.change.content),
  };
  const index = snapshot.procedures.findIndex(
    (p) => p.sourceId === replacement.sourceId,
  );
  if (index < 0) snapshot.procedures.push(replacement);
  else snapshot.procedures[index] = replacement;
  return snapshot;
}
async function owned(owner: OwnerPrincipal, db: Queryable, lock = false) {
  const query = db
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("shop");
}
/** A request identifier cannot be reused for a different saved actor plan. */
export function sameSimulationInput(
  row: SimulationRunRow,
  input: SimulationInput,
) {
  const a = row.input.change,
    b = input.change;
  if (
    row.input.scenario !== input.scenario ||
    row.input.expectedOutcome !== input.expectedOutcome ||
    a.kind !== b.kind ||
    JSON.stringify(row.input.steps ?? []) !==
      JSON.stringify(input.steps ?? []) ||
    (a.kind === "instruction" &&
      b.kind === "instruction" &&
      (a.id !== b.id || a.revision !== b.revision))
  ) {
    throw conflict(
      "This test request already names different wording or a different scenario.",
    );
  }
  return { created: false, row };
}

/**
 * Saves one exact scenario and source snapshot. Repeated requests return old evidence.
 * Capture uses a separate read-only transaction before the short claim transaction,
 * avoiding nested pools. The saved capture time makes later shop edits explicit.
 */
export async function claimSimulation(
  owner: OwnerPrincipal,
  raw: SimulationInput,
  generator: string,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.simulation.claimSimulation(owner, raw, generator);
  const input = SimulationInput.parse(raw);
  z.string().min(1).max(200).parse(generator);
  const db = getDb();
  await owned(owner, db);
  const [prior] = await db
    .select()
    .from(simulationRun)
    .where(
      and(
        eq(simulationRun.id, input.requestId),
        eq(simulationRun.sellerId, owner.sellerId),
      ),
    );
  if (prior) return sameSimulationInput(prior, input);
  const snapshot = await captureSimulationShop(owner);
  return transaction(db, async (tx) => {
    await owned(owner, tx, true);
    const [existing] = await tx
      .select()
      .from(simulationRun)
      .where(eq(simulationRun.id, input.requestId));
    if (existing) {
      if (existing.sellerId !== owner.sellerId) throw notFound("test");
      return sameSimulationInput(existing, input);
    }
    let change: SimulationChange = null;
    if (input.change.kind === "instruction") {
      const [instruction] = await tx
        .select()
        .from(assistantProcedure)
        .where(
          and(
            eq(assistantProcedure.id, input.change.id),
            eq(assistantProcedure.sellerId, owner.sellerId),
          ),
        )
        .for("update");
      if (!instruction) throw notFound("instruction");
      if (
        instruction.archived ||
        instruction.revision !== input.change.revision
      )
        throw conflict(
          "The saved instruction changed. Reload it before starting a test.",
        );
      const captured = snapshot.procedures.find(
        (p) => p.sourceId === instruction.id,
      );
      if ((captured?.revision ?? null) !== instruction.publishedRevision)
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
    await tx
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
          sql`${simulationRun.expiresAt} <= now()`,
        ),
      );
    const [active] = await tx
      .select({ id: simulationRun.id })
      .from(simulationRun)
      .where(
        and(
          eq(simulationRun.sellerId, owner.sellerId),
          eq(simulationRun.state, "running"),
        ),
      );
    if (active)
      throw conflict(
        "A shop test is already running. Let it finish before starting another.",
      );
    const [row] = await tx
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
      .returning();
    if (!row) throw new Error("simulation insert returned nothing");
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "simulation.start",
      targetType: "simulation",
      targetId: row.id,
      outcome: "ok",
    });
    return { created: true, row };
  });
}

/** Saves a side once. Expected-outcome failures remain visible even when both trials finish. */
export async function saveSimulationResult(
  owner: OwnerPrincipal,
  id: string,
  side: "current" | "proposed",
  raw: SimulationSideResult,
  finished = true,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.simulation.saveSimulationResult(
      owner,
      id,
      side,
      raw,
      finished,
    );
  z.uuid().parse(id);
  const result = SimulationSideResult.parse(raw);
  return transaction(getDb(), async (tx) => {
    await owned(owner, tx, true);
    const [row] = await tx
      .select()
      .from(simulationRun)
      .where(
        and(
          eq(simulationRun.id, id),
          eq(simulationRun.sellerId, owner.sellerId),
        ),
      )
      .for("update");
    if (!row) throw notFound("test");
    if (row.state !== "running" || row.expiresAt <= new Date())
      throw conflict(
        "This test stopped or finished. Earlier results are preserved.",
      );
    if (
      (side === "current" && row.currentResult) ||
      (side === "proposed" &&
        (!row.change || !row.currentResult || row.proposedResult))
    )
      throw conflict("This result was already saved or arrived out of order.");
    const state = !finished
      ? "failed"
      : side === "current" && row.change
        ? "running"
        : "completed";
    const [saved] = await tx
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
      .where(
        and(
          eq(simulationRun.id, id),
          eq(simulationRun.sellerId, owner.sellerId),
        ),
      )
      .returning();
    await recordAudit(tx, {
      actor: "system",
      operation: "simulation.result",
      targetType: "simulation",
      targetId: id,
      outcome: finished ? "ok" : "failed",
      details: { side, finished },
    });
    return saved!;
  });
}

/** Records interruption without erasing a completed side or exposing a provider error body. */
export async function failSimulation(owner: OwnerPrincipal, id: string) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.simulation.failSimulation(owner, id);
  z.uuid().parse(id);
  await transaction(getDb(), async (tx) => {
    await owned(owner, tx, true);
    const [row] = await tx
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
      )
      .returning({ id: simulationRun.id });
    if (row)
      await recordAudit(tx, {
        actor: "system",
        operation: "simulation.failed",
        targetType: "simulation",
        targetId: id,
        outcome: "failed",
      });
  });
}

/** Safe report projection; reading an expired run does not change stored state. */
export function simulationView(row: SimulationRunRow): SimulationView {
  const expired = row.state === "running" && row.expiresAt <= new Date();
  return {
    id: row.id,
    scenario: row.input.scenario,
    expectedOutcome: row.input.expectedOutcome,
    change: row.change,
    products: row.snapshot.products.map(product => ({ id: product.sourceId, title: product.title })),
    steps: row.input.steps ?? [],
    state: expired ? "failed" : row.state,
    generator: row.generator,
    capturedAt: row.snapshot.capturedAt,
    current: row.currentResult,
    proposed: row.proposedResult,
    failure: expired
      ? "This test stopped before finishing. Earlier results are preserved."
      : row.failure,
    limitations: row.snapshot.limitations,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Lists only the current owner's private comparisons, newest first. */
export async function listSimulations(
  owner: OwnerPrincipal,
): Promise<SimulationView[]> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.simulation.listSimulations(owner);
  const db = getDb();
  await owned(owner, db);
  return (
    await db
      .select()
      .from(simulationRun)
      .where(eq(simulationRun.sellerId, owner.sellerId))
      .orderBy(desc(simulationRun.createdAt), desc(simulationRun.id))
      .limit(20)
  ).map(simulationView);
}
