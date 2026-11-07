/**
 * An optional dollar budget for this installation's AI key (AI_BUDGET_USD).
 *
 * Every model call's reported tokens are priced and added to one running total in
 * micro-dollars (millionths of a US dollar). Once the total reaches the budget the
 * assistant is off: the shop keeps selling as a plain catalog and the owner sees why
 * in Setup. Raising the budget turns it back on. Unset, nothing is measured or limited.
 *
 * Prices are US dollars per million tokens. The table covers the models these docs
 * suggest; AI_PRICE_PER_MILLION_TOKENS ("input,output") prices any other model. A model
 * with no known price cannot run under a budget, so spend is never counted as zero.
 */
import { wrapLanguageModel, type LanguageModel } from "ai";
import { getDb } from "@/server/db/client";
import { addUsage, hasUsageLeft } from "@/server/domain/usage";
import { getRequestScope, withD1Database, withRequestDatabase } from "@/server/request-scope";

/** US dollars per million input and output tokens. */
export type Price = { input: number; output: number };

/**
 * Published list prices, read 7 Nov 2026 from LiteLLM's model_prices_and_context_window.json
 * (github.com/BerriAI/litellm, commit b603e84c020c). Input tokens include cached reads, which
 * makes the estimate a little high rather than low.
 */
export const MODEL_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};

// One window that never rolls over, so spend keeps adding up until the budget is raised.
const ALL_TIME_SECONDS = 10_000_000_000;
const SPEND_FEATURE = "ai_spend_total_micros";
const SPEND_PRINCIPAL = "installation";

/**
 * The price for a model id as providers and gateways write it: "claude-sonnet-5-5",
 * "anthropic/claude-sonnet-5.5" or "openrouter/anthropic/claude-sonnet-5.5".
 */
export function priceFor(modelId: string, override?: Price | null): Price | null {
  if (override) return override;
  const name = modelId.split("/").pop()!.toLowerCase().replace(/(\d)\.(\d)/g, "$1-$2");
  return MODEL_PRICES[name] ?? null;
}

/** Parses AI_PRICE_PER_MILLION_TOKENS, "input,output" in US dollars, such as "2,10". */
export function parsePrice(value: string | undefined): Price | null {
  const parts = value?.split(",").map((part) => Number(part.trim()));
  if (!parts || parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { input: parts[0]!, output: parts[1]! };
}

/** Micro-dollars for a number of tokens at a price. */
export function costMicros(price: Price, inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * price.input + outputTokens * price.output);
}

/** Records spend in micro-dollars. */
export type SpendRecorder = (micros: number) => Promise<void>;

/**
 * Records spend in the database of the scope it was created in. A shop test runs its model
 * calls inside a throwaway database, so it carries the real shop's recorder instead.
 */
export function spendRecorder(): SpendRecorder {
  const scope = getRequestScope();
  if (scope?.simulation) return scope.simulation.recordSpend ?? (async () => {});
  const add = (micros: number) => addUsage(SPEND_FEATURE, SPEND_PRINCIPAL, ALL_TIME_SECONDS, micros);
  if (scope?.d1) {
    const d1 = scope.d1;
    return (micros) => withD1Database(d1, () => add(micros));
  }
  const db = getDb();
  return (micros) => withRequestDatabase(db, () => add(micros));
}

/** Counts the tokens of every call made through the model and records what they cost. */
export function meterModel(model: LanguageModel, price: Price, record: SpendRecorder): LanguageModel {
  // A failed write must not fail the customer's reply; the next call is still counted.
  const charge = (input: number | undefined, output: number | undefined) =>
    record(costMicros(price, input ?? 0, output ?? 0)).catch(() => console.error("AI spend could not be recorded."));
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        await charge(result.usage.inputTokens.total, result.usage.outputTokens.total);
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const { stream, ...rest } = await doStream();
        const counted = stream.pipeThrough(new TransformStream({
          async transform(part, controller) {
            if (part.type === "finish") await charge(part.usage.inputTokens.total, part.usage.outputTokens.total);
            controller.enqueue(part);
          },
        }));
        return { stream: counted, ...rest };
      },
    },
  });
}

export type Budgeted =
  | { ok: true; model: LanguageModel }
  | { ok: false; problem: string };

/**
 * Applies the budget to a model: unchanged without one, metered while total spend is
 * under it, and off once it is used. A shop test was checked when it started, so its
 * calls are only counted.
 */
export async function withBudget(
  model: LanguageModel,
  modelId: string,
  settings: { budgetUsd?: number; priceOverride?: string },
): Promise<Budgeted> {
  if (!settings.budgetUsd) return { ok: true, model };
  const price = priceFor(modelId, parsePrice(settings.priceOverride));
  if (!price) {
    return { ok: false, problem: `The AI budget needs this model's price. Set AI_PRICE_PER_MILLION_TOKENS for ${modelId}, or remove AI_BUDGET_USD.` };
  }
  if (!getRequestScope()?.simulation) {
    const budgetMicros = Math.round(settings.budgetUsd * 1_000_000);
    if (!(await hasUsageLeft(SPEND_FEATURE, SPEND_PRINCIPAL, ALL_TIME_SECONDS, budgetMicros))) {
      return { ok: false, problem: "The AI budget is used up. The shop keeps selling without the assistant until the owner raises AI_BUDGET_USD." };
    }
  }
  return { ok: true, model: meterModel(model, price, spendRecorder()) };
}
