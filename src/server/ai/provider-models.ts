/**
 * Lists the chat models a provider offers to this key, from the provider's own
 * model-list endpoint, so Setup never offers a model from a stale built-in list.
 *
 * Only models that can hold a conversation are returned (the endpoints also list
 * embedding, image and speech models). Provider error bodies are never passed on,
 * because some echo the request's credentials.
 */
import { createGateway } from "ai";
import type { AiProviderName } from "@/server/env";

export type ProviderModel = { id: string; label: string };
export type ProviderModelList = { ok: true; models: ProviderModel[] } | { ok: false; problem: string };

const TIMEOUT_MS = 10_000;
const MAX_MODELS = 300;

class ListError extends Error {}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 401 || response.status === 403) throw new ListError("The provider refused this key.");
  if (!response.ok) throw new ListError(`The provider could not list models (HTTP ${response.status}).`);
  return response.json();
}

type Row = Record<string, unknown>;
const rows = (value: unknown, field: string): Row[] => {
  const list = (value as Row | null)?.[field];
  return Array.isArray(list) ? (list.filter((item) => item && typeof item === "object") as Row[]) : [];
};
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

// OpenAI's list has no capability field; these families are not chat models.
const OPENAI_NOT_CHAT = /(embedding|tts|whisper|dall-e|image|audio|realtime|moderation|transcribe|search|computer-use|davinci|babbage|sora)/;

const LISTERS: Record<AiProviderName, (apiKey: string) => Promise<ProviderModel[]>> = {
  // https://docs.claude.com/en/api/models-list
  anthropic: async (apiKey) =>
    rows(await getJson("https://api.anthropic.com/v1/models?limit=1000", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }), "data")
      .flatMap((m) => (text(m.id) ? [{ id: m.id as string, label: text(m.display_name) ?? (m.id as string) }] : [])),
  // https://platform.openai.com/docs/api-reference/models/list
  openai: async (apiKey) =>
    rows(await getJson("https://api.openai.com/v1/models", { authorization: `Bearer ${apiKey}` }), "data")
      .flatMap((m) => {
        const id = text(m.id);
        return id && /^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_NOT_CHAT.test(id) ? [{ id, label: id }] : [];
      })
      .sort((a, b) => b.id.localeCompare(a.id)),
  // https://ai.google.dev/api/models#method:-models.list
  google: async (apiKey) =>
    rows(await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": apiKey }), "models")
      .flatMap((m) => {
        const id = text(m.name)?.replace(/^models\//, "");
        const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        return id && id.startsWith("gemini") && methods.includes("generateContent") ? [{ id, label: text(m.displayName) ?? id }] : [];
      }),
  // https://openrouter.ai/docs/api-reference/list-available-models; tool use is required by the assistant.
  openrouter: async (apiKey) =>
    rows(await getJson("https://openrouter.ai/api/v1/models", { authorization: `Bearer ${apiKey}` }), "data")
      .flatMap((m) => {
        const id = text(m.id);
        const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
        return id && params.includes("tools") ? [{ id, label: text(m.name) ?? id }] : [];
      }),
  // The AI SDK's own Gateway metadata call.
  gateway: async (apiKey) =>
    (await createGateway({ apiKey }).getAvailableModels()).models
      .filter((m) => m.modelType === "language")
      .map((m) => ({ id: m.id, label: m.name || m.id })),
};

/** Asks the provider which chat models this key can use. */
export async function listProviderModels(provider: AiProviderName, apiKey: string): Promise<ProviderModelList> {
  try {
    const models = (await LISTERS[provider](apiKey)).slice(0, MAX_MODELS);
    return models.length ? { ok: true, models } : { ok: false, problem: "This key has no chat models available." };
  } catch (error) {
    if (error instanceof ListError) return { ok: false, problem: error.message };
    if (error instanceof Error && error.name === "TimeoutError") return { ok: false, problem: "The provider did not answer in time." };
    return { ok: false, problem: "The provider could not list models. Check the key and try again." };
  }
}
