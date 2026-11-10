import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyAssistantModel = vi.hoisted(() => vi.fn());
vi.mock("@/server/ai/registry", async (original) => ({
  ...(await original<typeof import("@/server/ai/registry")>()),
  verifyAssistantModel,
}));

import { getDb } from "@/server/db/client";
import { auditEvent, installation } from "@/server/db/schema";
import { auditEvent as d1AuditEvent, installation as d1Installation } from "@/server/db/sqlite/schema";
import { describeAiConnection, removeAiConnection, saveAiConnection } from "@/server/domain/ai-settings";
import { getEffectiveConfig } from "@/server/effective-config";
import { resetServerConfigForTests } from "@/server/env";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";

const KEY = "sk-ant-test-key-wxyz";
const INPUT = { provider: "anthropic" as const, modelId: "claude-sonnet-5-5", apiKey: KEY };

for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: AI connection saved in Setup`, () => {
    let f: StorageFixture;
    const run = <T>(work: () => Promise<T>) =>
      f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    const stored = () =>
      run(async () => {
        const rows = f.binding
          ? await createD1Db(f.binding).select({ sealed: d1Installation.aiSettingsSealed }).from(d1Installation)
          : await getDb().select({ sealed: installation.aiSettingsSealed }).from(installation);
        return rows[0]?.sealed ?? null;
      });
    const audits = () =>
      run(async () =>
        f.binding
          ? createD1Db(f.binding).select({ operation: d1AuditEvent.operation, details: d1AuditEvent.details }).from(d1AuditEvent)
          : getDb().select({ operation: auditEvent.operation, details: auditEvent.details }).from(auditEvent),
      );

    beforeEach(async () => {
      vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "c".repeat(64));
      vi.stubEnv("AI_PROVIDER", "");
      vi.stubEnv("AI_MODEL_ID", "");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      resetServerConfigForTests();
      verifyAssistantModel.mockReset();
      verifyAssistantModel.mockResolvedValue({ ok: true, provider: "anthropic", modelId: INPUT.modelId, latencyMs: 12 });
      f = await newStorageFixture(dialect);
      if (!f.binding) await getDb().update(installation).set({ aiSettingsSealed: null });
      // The Cloudflare installer writes this row; the D1 test binding starts without it.
      else await f.binding.prepare("INSERT INTO installation(singleton, environment) VALUES (1, 'sandbox') ON CONFLICT(singleton) DO NOTHING").run();
    });
    afterEach(async () => {
      await f?.close();
      vi.unstubAllEnvs();
      resetServerConfigForTests();
    });

    it("tests, seals and applies a key, and never exposes it", async () => {
      expect((await run(getEffectiveConfig)).ai.status).toBe("unavailable");
      const result = await run(() => saveAiConnection(f.owner, INPUT));
      expect(result).toEqual({ ok: true, latencyMs: 12, keyMask: "sk-ant-••••wxyz" });
      expect(verifyAssistantModel).toHaveBeenCalledWith({ status: "ready", provider: "anthropic", modelId: INPUT.modelId, apiKey: KEY });

      const sealed = await stored();
      expect(sealed?.startsWith("v1.")).toBe(true);
      expect(sealed).not.toContain("test-only");

      const ai = (await run(getEffectiveConfig)).ai;
      expect(ai).toEqual({ status: "ready", provider: "anthropic", modelId: INPUT.modelId, apiKey: KEY });

      const view = await run(describeAiConnection);
      expect(view).toMatchObject({ source: "saved", keyMask: "sk-ant-••••wxyz", unreadable: false });
      expect(JSON.stringify(view)).not.toContain("test-only");

      const log = await audits();
      expect(log.map((row) => row.operation)).toContain("save_ai_connection");
      expect(JSON.stringify(log)).not.toContain("test-only");
    });

    it("stores nothing when the test request fails", async () => {
      verifyAssistantModel.mockResolvedValue({ ok: false, provider: "anthropic", modelId: INPUT.modelId, problem: "The provider refused this key." });
      expect(await run(() => saveAiConnection(f.owner, INPUT))).toEqual({ ok: false, problem: "The provider refused this key." });
      expect(await stored()).toBeNull();
      expect((await audits()).map((row) => row.operation)).not.toContain("save_ai_connection");
    });

    it("falls back to host settings when the host key changes, and says so", async () => {
      await run(() => saveAiConnection(f.owner, INPUT));
      vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "d".repeat(64));
      vi.stubEnv("AI_PROVIDER", "openai");
      vi.stubEnv("AI_MODEL_ID", "gpt-5-mini");
      vi.stubEnv("OPENAI_API_KEY", "sk-proj-host-0000");
      resetServerConfigForTests();
      const ai = (await run(getEffectiveConfig)).ai;
      expect(ai).toMatchObject({ status: "ready", provider: "openai", modelId: "gpt-5-mini" });
      expect(await run(describeAiConnection)).toMatchObject({ source: "environment", unreadable: true });
    });

    it("removing the saved key restores host settings", async () => {
      vi.stubEnv("AI_PROVIDER", "openai");
      vi.stubEnv("AI_MODEL_ID", "gpt-5-mini");
      vi.stubEnv("OPENAI_API_KEY", "sk-proj-host-0000");
      resetServerConfigForTests();
      await run(() => saveAiConnection(f.owner, INPUT));
      expect((await run(getEffectiveConfig)).ai).toMatchObject({ provider: "anthropic" });
      await run(() => removeAiConnection(f.owner));
      expect(await stored()).toBeNull();
      expect((await run(getEffectiveConfig)).ai).toMatchObject({ provider: "openai" });
      expect((await audits()).map((row) => row.operation)).toContain("remove_ai_connection");
    });

    it("works without SETTINGS_ENCRYPTION_KEY by deriving from the app secret", async () => {
      vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "");
      resetServerConfigForTests();
      expect(await run(() => saveAiConnection(f.owner, INPUT))).toMatchObject({ ok: true });
      expect((await run(getEffectiveConfig)).ai).toMatchObject({ provider: "anthropic", apiKey: KEY });
      vi.stubEnv("BETTER_AUTH_SECRET", "a-different-app-secret-of-at-least-32-chars");
      resetServerConfigForTests();
      expect(await run(describeAiConnection)).toMatchObject({ unreadable: true });
      expect((await run(getEffectiveConfig)).ai.status).toBe("unavailable");
    });
  });
