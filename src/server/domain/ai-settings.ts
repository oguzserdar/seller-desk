/**
 * The AI connection an owner saves in Setup, as an alternative to host settings.
 *
 * A saved connection is sealed with the settings key (see secret-box)
 * and takes precedence over AI_PROVIDER / AI_MODEL_ID / the provider key in the
 * environment; removing it restores the environment's connection. The key is
 * tested with a real model call before it is saved, is never returned to the
 * browser (only a mask), and every save or removal is audited. Trial databases
 * start from a fresh installation row, so a saved key is never copied into one.
 */
import { verifyAssistantModel } from "@/server/ai/registry";
import { getDb, transaction } from "@/server/db/client";
import { installation } from "@/server/db/schema";
import {
  AI_CONNECTION_PURPOSE,
  AiConnectionInput,
  readSavedAiConnection,
} from "@/server/effective-config";
import { getServerConfig, type AiProviderName, type ServerConfig } from "@/server/env";
import { getRequestScope } from "@/server/request-scope";
import { maskSecret, resolveSettingsKey, sealSecret } from "@/server/secret-box";
import { getStorage } from "@/server/storage";
import { recordAudit } from "./audit";
import type { OwnerPrincipal } from "./principal";

export { AiConnectionInput };

/** What Setup may show. Never contains a key, only its mask. */
export type AiConnectionView = {
  source: "saved" | "environment" | "none";
  provider: string | null;
  modelId: string | null;
  keyMask: string | null;
  /** A saved connection exists but this host's key cannot open it. */
  unreadable: boolean;
};

function currentKeyMask(config: ServerConfig): string | null {
  if (config.ai.status !== "ready" || !config.ai.apiKey) return null;
  return maskSecret(config.ai.apiKey);
}

/** The connection Setup shows, described without revealing any credential. */
export async function describeAiConnection(): Promise<AiConnectionView> {
  const base = getServerConfig();
  const saved = await readSavedAiConnection(base);
  if (saved.state === "ok") {
    return { source: "saved", provider: saved.value.provider, modelId: saved.value.modelId, keyMask: maskSecret(saved.value.apiKey), unreadable: false };
  }
  const unreadable = saved.state === "unreadable";
  if (base.ai.status === "ready") {
    return { source: "environment", provider: base.ai.provider, modelId: base.ai.modelId, keyMask: currentKeyMask(base), unreadable };
  }
  return { source: "none", provider: base.ai.provider, modelId: base.ai.modelId, keyMask: null, unreadable };
}

async function writeSealed(owner: OwnerPrincipal, sealed: string | null, details: Record<string, string>): Promise<void> {
  const scope = getRequestScope();
  if (scope) scope.effectiveConfig = undefined;
  const backend = getStorage();
  if (backend.kind === "d1") return backend.aiSettings.writeSealedAiSettings(owner, sealed, details);
  await transaction(getDb(), async (tx) => {
    await tx.update(installation).set({ aiSettingsSealed: sealed });
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: sealed ? "save_ai_connection" : "remove_ai_connection",
      targetType: "installation",
      outcome: "ok",
      details,
    });
  });
}

export type SaveAiConnectionResult = { ok: true; latencyMs: number; keyMask: string } | { ok: false; problem: string };

/** Tests the connection with a real model call, then seals and saves it. Nothing is stored on failure. */
export async function saveAiConnection(owner: OwnerPrincipal, input: AiConnectionInput): Promise<SaveAiConnectionResult> {
  const check = await verifyAssistantModel({ status: "ready", provider: input.provider as AiProviderName, modelId: input.modelId, apiKey: input.apiKey });
  if (!check.ok) return { ok: false, problem: check.problem };
  const sealed = await sealSecret(await resolveSettingsKey(getServerConfig()), AI_CONNECTION_PURPOSE, JSON.stringify(input));
  const keyMask = maskSecret(input.apiKey);
  await writeSealed(owner, sealed, { provider: input.provider, modelId: input.modelId, keyMask });
  return { ok: true, latencyMs: check.latencyMs, keyMask };
}

/** Deletes the saved connection; the environment's connection applies again. */
export async function removeAiConnection(owner: OwnerPrincipal): Promise<void> {
  await writeSealed(owner, null, {});
}
