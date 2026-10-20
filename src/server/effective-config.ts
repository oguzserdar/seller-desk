/**
 * The settings a request runs with: host settings, with an AI connection saved
 * in Setup applied on top when this installation's settings key opens it.
 * Saving and removing live in domain/ai-settings.
 */
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { installation } from "@/server/db/schema";
import { AI_PROVIDERS, PROVIDER_KEY_ENV, getServerConfig, parseServerConfig, type ServerConfig } from "@/server/env";
import { getRequestScope, simulationConfig } from "@/server/request-scope";
import { openSecret, resolveSettingsKey } from "@/server/secret-box";
import { getStorage } from "@/server/storage";

export const AI_CONNECTION_PURPOSE = "seller-desk/installation/ai-connection/v1";

export const AiConnectionInput = z.object({
  provider: z.enum(AI_PROVIDERS),
  modelId: z.string().trim().min(1).max(200).regex(/^[\w./:@-]+$/, "Use the model ID exactly as your provider lists it."),
  apiKey: z.string().trim().min(20, "That key looks too short.").max(400).regex(/^\S+$/, "A key has no spaces."),
});
export type AiConnectionInput = z.infer<typeof AiConnectionInput>;

async function readSealed(): Promise<string | null> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.aiSettings.readSealedAiSettings();
  const [row] = await getDb().select({ sealed: installation.aiSettingsSealed }).from(installation);
  return row?.sealed ?? null;
}

export async function readSavedAiConnection(base: ServerConfig): Promise<{ state: "none" } | { state: "unreadable" } | { state: "ok"; value: AiConnectionInput }> {
  const sealed = await readSealed();
  if (!sealed) return { state: "none" };
  const plain = await openSecret(await resolveSettingsKey(base), AI_CONNECTION_PURPOSE, sealed);
  let parsed: ReturnType<typeof AiConnectionInput.safeParse> | null = null;
  try { parsed = plain ? AiConnectionInput.safeParse(JSON.parse(plain)) : null; } catch { parsed = null; }
  if (!parsed?.success) return { state: "unreadable" };
  return { state: "ok", value: parsed.data };
}

function withConnection(value: AiConnectionInput): ServerConfig {
  return parseServerConfig({
    ...process.env,
    AI_PROVIDER: value.provider,
    AI_MODEL_ID: value.modelId,
    [PROVIDER_KEY_ENV[value.provider][0] as string]: value.apiKey,
  });
}

/**
 * Settings for this request: the environment, with a saved AI connection applied
 * when one opens. Trials keep their own isolated configuration. Read once per request.
 */
export function getEffectiveConfig(): Promise<ServerConfig> {
  const trial = simulationConfig();
  if (trial) return Promise.resolve(trial);
  const scope = getRequestScope();
  if (scope?.effectiveConfig) return scope.effectiveConfig;
  const pending = (async () => {
    const base = getServerConfig();
    const saved = await readSavedAiConnection(base);
    if (saved.state === "unreadable") console.warn("A saved AI connection could not be opened with this installation's settings key; using host settings.");
    return saved.state === "ok" ? withConnection(saved.value) : base;
  })();
  if (scope) {
    scope.effectiveConfig = pending;
    pending.catch(() => { if (scope.effectiveConfig === pending) scope.effectiveConfig = undefined; });
  }
  return pending;
}
