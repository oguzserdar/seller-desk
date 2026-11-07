import { getEffectiveConfig } from "@/server/effective-config";
import { meterModel, priceFor, spendRecorder } from "./spend";
import { getDb } from "@/server/db/client";
import { recordAudit } from "@/server/domain/audit";
import { DomainError } from "@/server/domain/errors";
import {
  getServerConfig,
  type RoutingConfig,
  type RoutingProvider,
} from "@/server/env";
import { getStorage } from "@/server/storage";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createGateway,
  experimental_decide,
  type Experimental_DecisionModel,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getAssistantModel, PROVIDER_FACTORIES } from "./registry";
import {
  canUseRoutineModel,
  handlingGuidance,
  handlingQuestion,
  HandlingRoute,
  routingState,
} from "./routing-policy";

/** Maximum extra latency before the main reply model handles the turn directly. */
export const ROUTING_TIMEOUT_MS = 2500;
/** Decision adapters. Injectable transport is for network-boundary tests only. */
export const DECISION_FACTORIES: Record<
  RoutingProvider,
  (
    key: string | null,
    modelId: string,
    fetch?: typeof globalThis.fetch,
  ) => Experimental_DecisionModel
> = {
  gateway: (apiKey, modelId, fetch) =>
    createGateway({ ...(apiKey ? { apiKey } : {}), fetch }).decisionModel(
      modelId,
    ),
  openrouter: (apiKey, modelId, fetch) =>
    createOpenRouter({ apiKey: apiKey ?? undefined, fetch }).decisionModel(
      modelId,
    ),
  typesafe: (apiKey, modelId, fetch) =>
    createTypeSafeAi({ apiKey: apiKey ?? undefined, fetch }).decisionModel(
      modelId,
    ),
  openai: (apiKey, modelId, fetch) =>
    createOpenAI({ apiKey: apiKey ?? undefined, fetch }).decisionModel(modelId),
  anthropic: (apiKey, modelId, fetch) =>
    createAnthropic({ apiKey: apiKey ?? undefined, fetch }).decisionModel(
      modelId,
    ),
};

/** How long a provider's access refusal (401/403) switches the router off before trying again. */
export const ACCESS_REFUSED_PAUSE_MS = 10 * 60_000;
// A refusal will not fix itself on the next message, so stop paying its latency on every turn.
const refusedUntil = new Map<string, number>();
/** Clears remembered access refusals between tests. */
export function resetRoutingAccessForTests(): void {
  refusedUntil.clear();
}

/** Safe operational evidence; no transcript, secret, raw provider error or payment details. */
export type RouteTrace = {
  status:
    | "off"
    | "unavailable"
    | "accepted"
    | "classified"
    | "uncertain"
    | "failed";
  route: HandlingRoute | null;
  probability: number | null;
  provider: string | null;
  modelId: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

/** Runs one bounded real decision request. Cancellation propagates instead of starting another model. */
export async function decideHandling(
  config: RoutingConfig,
  state: ReturnType<typeof routingState>,
  signal?: AbortSignal,
): Promise<RouteTrace> {
  signal?.throwIfAborted();
  const trace: RouteTrace = {
    status: config.status === "off" ? "off" : "unavailable",
    route: null,
    probability: null,
    provider: config.status === "off" ? null : config.provider,
    modelId: config.status === "off" ? null : config.modelId,
    latencyMs: 0,
    inputTokens: null,
    outputTokens: null,
  };
  if (config.status !== "ready") return trace;
  const key = `${config.provider}:${config.modelId}`;
  if ((refusedUntil.get(key) ?? 0) > Date.now()) return trace;
  const started = performance.now();
  try {
    const timeout = AbortSignal.timeout(ROUTING_TIMEOUT_MS);
    const result = await experimental_decide({
      model: DECISION_FACTORIES[config.provider](config.apiKey, config.modelId),
      state,
      questions: handlingQuestion(state.actor),
      maxRetries: 0,
      abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    signal?.throwIfAborted();
    const route = HandlingRoute.parse(result.answers.route.choice);
    const probability = z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .parse(result.answers.route.probabilities?.[route] ?? null);
    // Structured Claude choices supply a category, not a native probability distribution.
    const status =
      probability !== null && probability >= config.minProbability
        ? "accepted"
        : config.provider === "anthropic" && probability === null
          ? "classified"
          : "uncertain";
    return {
      ...trace,
      route,
      probability,
      status,
      modelId: result.response.modelId,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
    };
  } catch (error) {
    signal?.throwIfAborted();
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (statusCode === 401 || statusCode === 403)
      refusedUntil.set(key, Date.now() + ACCESS_REFUSED_PAUSE_MS);
    return {
      ...trace,
      status: "failed",
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

/** Selects a real answer model. Optional routing failures never produce a scripted reply. */
export async function routeAssistantTurn(input: {
  role: "buyer" | "owner";
  messages: UIMessage[];
  currentState: string;
  signal?: AbortSignal;
  forceMain?: boolean;
}) {
  const main = await getAssistantModel();
  if (!main.ok)
    throw new DomainError(
      "unavailable",
      "The assistant is not connected. Add its provider key in Setup.",
    );
  const config = await getEffectiveConfig();
  const trace = await decideHandling(
    config.routing,
    routingState(input.role, input.messages, input.currentState),
    input.signal,
  );
  const routine = config.routineAi;
  // Under a budget the routine model is metered too; without a known price it is not used.
  const routinePrice = config.aiBudgetUsd && routine?.status === "ready" ? priceFor(routine.modelId) : null;
  const useRoutine =
    trace.status === "accepted" &&
    routine?.status === "ready" &&
    (!config.aiBudgetUsd || routinePrice !== null) &&
    config.routing.status === "ready" &&
    canUseRoutineModel(
      trace.route,
      trace.probability,
      config.routing.minProbability,
      input.forceMain ?? false,
    );
  return {
    model: useRoutine
      ? routinePrice
        ? meterModel(PROVIDER_FACTORIES[routine.provider](routine.apiKey, routine.modelId), routinePrice, spendRecorder())
        : PROVIDER_FACTORIES[routine.provider](routine.apiKey, routine.modelId)
      : main.model,
    provider: useRoutine ? routine.provider : main.provider,
    modelId: useRoutine ? routine.modelId : main.modelId,
    tier: useRoutine ? ("routine" as const) : ("main" as const),
    trace,
    guidance: handlingGuidance(
      trace.status === "accepted" || trace.status === "classified"
        ? trace.route
        : null,
    ),
  };
}

/** Records model selection after authenticated turn ownership; excludes message content and credentials. */
export async function recordRouting(
  selected: Awaited<ReturnType<typeof routeAssistantTurn>>,
  actor: "buyer" | "owner",
  actorId: string,
  conversationId: string,
): Promise<void> {
  const entry = {
    actor,
    actorId,
    operation: "ai_route",
    targetType: "conversation",
    targetId: conversationId,
    outcome: "ok" as const,
    details: {
      ...selected.trace,
      answerProvider: selected.provider,
      answerModel: selected.modelId,
      tier: selected.tier,
    },
  };
  const backend = getStorage();
  if (backend.kind === "d1") return backend.audit.record(entry);
  await recordAudit(getDb(), entry);
}
