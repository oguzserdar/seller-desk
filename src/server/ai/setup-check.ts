import { getEffectiveConfig } from "@/server/effective-config";
import { createHmac } from "node:crypto";
import { experimental_decide } from "ai";
import type { ServerConfig } from "@/server/env";
import { DECISION_FACTORIES } from "./routing";
import { verifyAssistantModel } from "./registry";

/** Credential-bound proof for the complete configured AI stack, without storing any key. */
export function aiSetupKey(config: ServerConfig): string {
  const endpoints = { openai: process.env.OPENAI_BASE_URL ?? null };
  const input = JSON.stringify({ ai: config.ai, routing: config.routing, routine: config.routineAi, endpoints });
  return `ai-stack-v3:${createHmac("sha256", config.authSecret).update(input).digest("hex")}`;
}

/** A connection check proves protocols, not answer quality or savings. */
export type AiSetupCheck = { ok: boolean; proofKey: string; latencyMs: number; detail: string; problem?: string };

/** Checks configured reply and decision models sequentially, without commerce data or side effects. */
export async function verifyAiSetup(): Promise<AiSetupCheck> {
  const config = await getEffectiveConfig();
  const proofKey = aiSetupKey(config);
  const started = Date.now();
  const fail = (problem: string): AiSetupCheck => ({ ok: false, proofKey, latencyMs: Date.now() - started, detail: problem, problem });
  // Report all missing configuration before spending on any provider request.
  if (config.ai.status !== "ready") return fail(config.ai.problem);
  if (config.routing.status === "unavailable") return fail(`Decision model: ${config.routing.problem}`);
  if (config.routineAi?.status === "unavailable") return fail(`Optional routine model: ${config.routineAi.problem}`);
  if (config.routineAi && config.routing.status === "off") return fail("The routine model needs decision routing. Enable routing or remove the routine model settings.");
  if (config.routineAi && config.routing.status === "ready" && config.routing.provider === "anthropic") return fail("Haiku supplies a category without native probabilities. Remove the routine model settings, or choose Jev or OpenAI Decisions for probability-based model selection.");
  const main = await verifyAssistantModel(config.ai);
  if (!main.ok) return fail(`Reply model: ${main.problem}`);
  const checked = ["Reply model: tool and structured output"];
  if (config.routing.status === "ready") {
    const decision = config.routing;
    try {
      const value = crypto.randomUUID();
      const result = await experimental_decide({
        model: DECISION_FACTORIES[decision.provider](decision.apiKey, decision.modelId),
        state: { expected: value, observed: value },
        questions: { check: { type: "choice", instructions: "Compare the two values exactly.", criteria: { equal: "expected and observed are exactly equal", different: "expected and observed differ" } } },
        maxRetries: 0, abortSignal: AbortSignal.timeout(8000),
      });
      const probability = result.answers.check.probabilities?.equal;
      const validProbability = typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1;
      if (result.answers.check.choice !== "equal" || (!validProbability && !(decision.provider === "anthropic" && probability === undefined))) return fail("The decision model did not return its required category or probability. Check the model ID and provider support.");
      checked.push(decision.provider === "anthropic" ? "Decision model: structured classification (no probability distribution)" : "Decision model: category and probability");
    } catch {
      return fail("The decision model could not finish its connection check. Check its provider key, model access and usage allowance. The reply model can still answer.");
    }
  }
  if (config.routineAi) {
    const routine = await verifyAssistantModel(config.routineAi);
    if (!routine.ok) return fail(`Optional routine model: ${routine.problem}`);
    checked.push("Routine model: tool and structured output");
  }
  return { ok: true, proofKey, latencyMs: Date.now() - started, detail: checked.join("; ") };
}
