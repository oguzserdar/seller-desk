/**
 * Chooses the language model for this installation from AI_PROVIDER and
 * AI_MODEL_ID. Five native AI SDK providers are built in. There is no stand-in
 * model: without a configured provider the assistant is off and says so.
 *
 * Adding another AI SDK provider (for example @ai-sdk/mistral):
 *   1. pnpm add @ai-sdk/mistral
 *   2. add `mistral: (apiKey, modelId) => createMistral({ apiKey })(modelId)` below
 *   3. add "mistral" to AI_PROVIDERS and its key name to PROVIDER_KEY_ENV in env.ts
 */
import { getEffectiveConfig } from "@/server/effective-config";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, createGateway, generateText, isStepCount, NoOutputGeneratedError, Output, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { type AiConfig, type AiProviderName, getServerConfig, type ServerConfig } from "@/server/env";

type Factory = (apiKey: string | null, modelId: string) => LanguageModel;

export const PROVIDER_FACTORIES: Record<AiProviderName, Factory> = {
  // Without a key the Gateway provider uses the Vercel deployment's OIDC token.
  gateway: (apiKey, modelId) => createGateway(apiKey ? { apiKey } : {})(modelId),
  openrouter: (apiKey, modelId) => createOpenRouter({ apiKey: apiKey ?? undefined }).chat(modelId),
  openai: (apiKey, modelId) => createOpenAI({ apiKey: apiKey ?? undefined })(modelId),
  anthropic: (apiKey, modelId) => createAnthropic({ apiKey: apiKey ?? undefined })(modelId),
  google: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey: apiKey ?? undefined })(modelId),
};

/**
 * Claude models that refuse forced tool use: Anthropic answers tool_choice "any"
 * or "tool" with a 400 for Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1, and the
 * AI SDK quietly downgrades it to "auto". Asking for "required" then fails any
 * turn where the model answers directly, such as a greeting. These models get
 * "auto" and the prompt's instruction to read before answering, as Anthropic's
 * tool-use guide recommends. Matches direct, Gateway and OpenRouter model IDs.
 */
const REFUSES_FORCED_TOOL_USE = /claude-(opus-5[.-]5|sonnet-5[.-]5|fable-5[.-]1|mythos-5[.-]1)/;

/** Whether this model can be required to call a tool on a step. */
export function acceptsForcedToolUse(model: LanguageModel): boolean {
  return !REFUSES_FORCED_TOOL_USE.test(typeof model === "string" ? model : model.modelId);
}

export type AssistantModel =
  | { ok: true; model: LanguageModel; provider: AiProviderName; modelId: string }
  | { ok: false; problem: string };

/** Builds the configured model per request; provider objects are cheap and hold no connection. */
export async function getAssistantModel(): Promise<AssistantModel> {
  const ai = (await getEffectiveConfig()).ai;
  if (ai.status !== "ready") return { ok: false, problem: ai.problem };
  return { ok: true, model: PROVIDER_FACTORIES[ai.provider](ai.apiKey, ai.modelId), provider: ai.provider, modelId: ai.modelId };
}

/** Limits from the build contract: short turns, a few tool steps, bounded time. */
export const ASSISTANT_LIMITS = {
  maxInputChars: 4000,
  maxOutputTokens: 1500,
  maxSteps: 8,
  timeoutMs: 45_000,
} as const;

/** Settings shared by every assistant call: the configured reasoning level, when one is set. */
export function assistantCallSettings(config: Pick<ServerConfig, "aiReasoning"> = getServerConfig()) {
  return config.aiReasoning ? { reasoning: config.aiReasoning } : {};
}

/** A real model's bounded capability-check result; never includes provider response bodies. */
export type ModelCheck =
  | { ok: true; provider: AiProviderName; modelId: string; latencyMs: number }
  | { ok: false; provider: AiProviderName | null; modelId: string | null; problem: string };

/**
 * Checks real tool use and structured output with a random value available only
 * from a read-only tool. No shop data or commerce action is involved. Provider
 * exception bodies are never returned because they can echo credentials.
 */
export async function verifyAssistantModel(ai: AiConfig = getServerConfig().ai): Promise<ModelCheck> {
  if (ai.status !== "ready") return { ok: false, provider: ai.provider, modelId: ai.modelId, problem: ai.problem };
  const started = Date.now();
  const value = crypto.randomUUID();
  let toolRead = false;
  try {
    const model = PROVIDER_FACTORIES[ai.provider](ai.apiKey, ai.modelId);
    const result = await generateText({
      model,
      prompt: "Check the connection by calling read_connection_check once. Then return its exact value as the observed field in the required output. Do not invent a value.",
      tools: {
        read_connection_check: tool({
          description: "Read the random value for this connection check. This has no side effects.",
          inputSchema: z.object({}),
          execute: async () => { toolRead = true; return { value }; },
        }),
      },
      prepareStep: ({ stepNumber }) => ({ toolChoice: stepNumber > 0 ? "none" : acceptsForcedToolUse(model) ? { type: "tool", toolName: "read_connection_check" } : "auto" }),
      output: Output.object({ schema: z.object({ observed: z.string() }) }),
      stopWhen: isStepCount(2),
      maxOutputTokens: 256,
      maxRetries: 0,
      timeout: 30_000,
    });
    if (!toolRead || result.output?.observed !== value) {
      return { ok: false, provider: ai.provider, modelId: ai.modelId, problem: "The model did not complete the tool and structured-reply check. Choose a model that supports both, then try again." };
    }
    return { ok: true, provider: ai.provider, modelId: ai.modelId, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, provider: ai.provider, modelId: ai.modelId, problem: modelCheckProblem(error) };
  }
}

function modelCheckProblem(error: unknown): string {
  // Gateway wraps its verified API error; its prose and response body can contain secrets.
  const apiError = APICallError.isInstance(error) ? error
    : error instanceof Error && APICallError.isInstance(error.cause) ? error.cause : null;
  if (apiError) {
    if (apiError.statusCode === 401) return "The provider rejected this credential. Check the selected provider key or refresh the Vercel project connection.";
    if (apiError.statusCode === 403) return "The provider does not allow access to this model. Check its availability for your account or select another model.";
    if (apiError.statusCode === 429) return "The provider limited this request. Check your usage allowance or wait before trying again.";
    if (apiError.statusCode === 404) return "The provider could not find this model. Check the model ID and whether your account can use it.";
    if (apiError.statusCode && apiError.statusCode >= 500) return "The provider could not complete the check. Try again when its service is available.";
  }
  if (NoOutputGeneratedError.isInstance(error)) return "The model did not return the required format. Choose a model with tool use and structured replies, then try again.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "The connection check did not finish in time. Check the provider connection and try again.";
  return "The AI connection check could not finish. Check the provider key, model ID, and support for tool use and structured replies.";
}
