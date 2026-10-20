import type { SimulationSideResult } from "@/lib/simulation";
import { getSeller } from "@/server/domain/seller";
import { withD1Database } from "@/server/request-scope";
import { installSimulationShop } from "@/server/simulation/install-snapshot";
import {
  claimSimulation,
  failSimulation,
  listSimulations,
  saveSimulationResult,
} from "@/server/simulation/runs";
import { withIsolatedSimulation } from "@/server/simulation/scope";
import { captureSimulationShop } from "@/server/simulation/snapshot";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newD1TestDatabase } from "../support/d1";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";
const partial: SimulationSideResult = {
  transcript: [
    {
      role: "user",
      text: "Persistence fixture only. No AI answer was generated.",
    },
  ],
  tools: [],
  approvals: [],
  records: {
    quotes: 0,
    paidOrders: 0,
    captures: 0,
    pendingTasks: 0,
    completedTasks: 0,
    openSellerQuestions: 0,
  },
  checks: [
    {
      label: "Storage contract only",
      passed: false,
      detail: "No provider key or AI outcome is claimed.",
    },
  ],
  latencyMs: 0,
  inputTokens: null,
  outputTokens: null,
};
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: private simulation persistence`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
    });
    afterEach(async () => {
      await f?.close();
    });
    const run = <T>(work: () => Promise<T>) =>
      f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    const input = () => ({
      requestId: crypto.randomUUID(),
      scenario: "Can I pick this up on Friday?",
      expectedOutcome: "Ask the seller before promising a pickup time.",
      change: { kind: "none" as const },
    });
    it("captures only public facts without customer identities or private bytes", async () => {
      const snapshot = await run(() => captureSimulationShop(f.owner));
      expect(snapshot.products).toHaveLength(3);
      expect(JSON.stringify(snapshot)).not.toContain(f.owner.userId);
      expect(JSON.stringify(snapshot)).not.toContain(f.buyer.buyerSessionId);
      expect(JSON.stringify(snapshot)).not.toContain(f.assetId);
      expect(snapshot.products.find((p) => p.kind === "goods")!.available).toBe(
        2,
      );
    });
    it("claims one request under concurrency and retains partial failure without fabricated answers", async () => {
      const plan = input(),
        claims = await Promise.all([
          run(() => claimSimulation(f.owner, plan, "storage-contract")),
          run(() => claimSimulation(f.owner, plan, "storage-contract")),
        ]);
      expect(claims.filter((r) => r.created)).toHaveLength(1);
      await run(() =>
        saveSimulationResult(
          f.owner,
          plan.requestId,
          "current",
          partial,
          false,
        ),
      );
      expect((await run(() => listSimulations(f.owner)))[0]).toMatchObject({
        state: "failed",
        current: partial,
      });
      await run(() => failSimulation(f.owner, plan.requestId));
      await expect(
        run(() =>
          saveSimulationResult(f.owner, plan.requestId, "current", partial),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        Number(
          (
            await f.query(
              "select count(*) n from audit_event where operation='simulation.start'",
            )
          )[0]!.n,
        ),
      ).toBe(1);
    });
    it("requires current ownership for snapshots, claims and reports", async () => {
      const wrong = { ...f.owner, userId: crypto.randomUUID() };
      await expect(
        run(() => captureSimulationShop(wrong)),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        run(() => claimSimulation(wrong, input(), "storage-contract")),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(run(() => listSimulations(wrong))).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });
it("D1 installs a fictional copy only in a distinct empty target and refuses a second install", async () => {
  const f = await newStorageFixture("d1"),
    target = await newD1TestDatabase();
  try {
    await target.binding
      .prepare("insert into installation(environment) values ('fixture')")
      .run();
    const run = <T>(work: () => Promise<T>) =>
        withD1Database(createD1Db(f.binding!), work),
      snapshot = await run(() => captureSimulationShop(f.owner));
    await expect(
      run(() =>
        withIsolatedSimulation(
          f.owner,
          { kind: "d1", binding: f.binding! },
          async () => {},
        ),
      ),
    ).rejects.toThrow(/differ/);
    await run(() =>
      withIsolatedSimulation(
        f.owner,
        { kind: "d1", binding: target.binding },
        async () => {
          const installed = await installSimulationShop(snapshot);
          expect(installed.owner.sellerId).not.toBe(f.owner.sellerId);
          expect((await getSeller())!.displayName).toBe("Acceptance shop");
          await expect(installSimulationShop(snapshot)).rejects.toMatchObject({
            code: "conflict",
          });
        },
      ),
    );
    expect(
      (await target.binding.prepare("select filename from digital_asset").all())
        .results,
    ).toEqual([{ filename: "simulation-download.txt" }]);
    expect(
      (await f.query("select filename from digital_asset"))[0]!.filename,
    ).toBe("guide.txt");
  } finally {
    await target.close();
    await f.close();
  }
});

it("D1 refuses a sandbox simulation target before writing installation metadata", async () => {
  const source = await newStorageFixture("d1"),
    target = await newD1TestDatabase();
  try {
    await target.binding
      .prepare("insert into installation(environment) values ('sandbox')")
      .run();
    await expect(
      withD1Database(createD1Db(source.binding!), () =>
        withIsolatedSimulation(
          source.owner,
          { kind: "d1", binding: target.binding },
          async () => {},
        ),
      ),
    ).rejects.toThrow(/fixture/);
    expect(
      await target.binding
        .prepare("select count(*) n from storage_identity")
        .first("n"),
    ).toBe(0);
  } finally {
    await target.close();
    await source.close();
  }
});
