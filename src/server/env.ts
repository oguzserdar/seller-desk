/**
 * Server configuration, parsed once from the environment.
 *
 * Core settings (mode, origin, database, secrets) must be valid or the server
 * refuses to start. AI and PayPal settings are allowed to be missing: they turn
 * into readiness blockers so the owner can still sign in and buyers can still
 * browse manually. Nothing here ever switches a missing live setting to fixture.
 */
import { parseExactOrigin } from "@/lib/origin";
import {
  parseWooStore,
  type WooStoreConfig,
} from "@/server/commerce/woo-config";
import { simulationConfig } from "@/server/request-scope";
import { z } from "zod";

export const AI_PROVIDERS = [
  "gateway",
  "openrouter",
  "openai",
  "anthropic",
  "google",
] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];
export type AppMode = "fixture" | "sandbox";

/** Optional decision connections; selecting one never changes business permissions. */
export const ROUTING_PROVIDERS = [
  "gateway",
  "openrouter",
  "typesafe",
  "openai",
  "anthropic",
] as const;
/** A native or gateway connection used for advisory classification. */
export type RoutingProvider = (typeof ROUTING_PROVIDERS)[number];

/** Reasoning levels the AI SDK accepts for every provider. */
export const AI_REASONING_LEVELS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
] as const;

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = z.preprocess(
  blankToUndefined,
  z.string().trim().max(4096).optional(),
);

const origin = (name: string) =>
  z.string().transform((value, ctx) => {
    const parsed = parseExactOrigin(value);
    if (!parsed) {
      ctx.addIssue({
        code: "custom",
        message: `${name} must be an exact origin such as https://shop.example.com (http only for localhost)`,
      });
      return z.NEVER;
    }
    return parsed;
  });

const EnvSchema = z.object({
  APP_MODE: z.enum(["fixture", "sandbox"]),
  APP_URL: origin("APP_URL"),
  DATABASE_KIND: z.preprocess(
    blankToUndefined,
    z.enum(["postgres", "d1"]).default("postgres"),
  ),
  DATABASE_URL: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(
        /^postgres(ql)?:\/\//,
        "DATABASE_URL must be a postgres:// connection string",
      )
      .optional(),
  ),
  DATABASE_POOL_MAX: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(10),
  ),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.preprocess(
    blankToUndefined,
    origin("BETTER_AUTH_URL").optional(),
  ),
  JOBS_SECRET: z.string().min(32, "JOBS_SECRET must be at least 32 characters"),
  SETTINGS_ENCRYPTION_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "SETTINGS_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)")
      .optional(),
  ),
  AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(AI_PROVIDERS).optional()),
  AI_MODEL_ID: optionalText,
  AI_ROUTING_PROVIDER: z.preprocess(
    blankToUndefined,
    z.enum(["off", ...ROUTING_PROVIDERS]).optional(),
  ),
  AI_ROUTING_MODEL_ID: optionalText,
  AI_ROUTING_MIN_PROBABILITY: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0.8).max(1).default(0.95),
  ),
  AI_ROUTINE_PROVIDER: z.preprocess(
    blankToUndefined,
    z.enum(AI_PROVIDERS).optional(),
  ),
  AI_ROUTINE_MODEL_ID: optionalText,
  AI_REASONING: z.preprocess(
    blankToUndefined,
    z.enum(AI_REASONING_LEVELS).optional(),
  ),
  AI_BUDGET_USD: z.preprocess(
    blankToUndefined,
    z.coerce.number().positive().max(2000).optional(),
  ),
  AI_PRICE_PER_MILLION_TOKENS: optionalText,
  PUBLIC_DEMO: z.preprocess(blankToUndefined, z.enum(["true", "false"]).optional()),
  PAYPAL_AGENT_TOOLKIT: z.preprocess(blankToUndefined, z.enum(["on", "off"]).optional()),
  TYPESAFE_AI_API_KEY: optionalText,
  AI_GATEWAY_API_KEY: optionalText,
  VERCEL_OIDC_TOKEN: optionalText,
  OPENROUTER_API_KEY: optionalText,
  OPENAI_API_KEY: optionalText,
  ANTHROPIC_API_KEY: optionalText,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalText,
  PAYPAL_CLIENT_ID: optionalText,
  PAYPAL_CLIENT_SECRET: optionalText,
  PAYPAL_MERCHANT_ID: optionalText,
  PAYPAL_WEBHOOK_ID: optionalText,
  WOO_STORE_URL: optionalText,
});

type RawEnv = z.infer<typeof EnvSchema>;

/** Which credential each provider needs. Only the selected provider's key is ever read. */
export const PROVIDER_KEY_ENV: Record<AiProviderName, (keyof RawEnv)[]> = {
  gateway: ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"],
  openrouter: ["OPENROUTER_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
};

/** A configured provider is not yet proof that it answers; see verifyAssistantModel(). */
export type AiConfig =
  | {
      status: "ready";
      provider: AiProviderName;
      modelId: string;
      apiKey: string | null;
    }
  | {
      status: "unavailable";
      provider: AiProviderName | null;
      modelId: string | null;
      problem: string;
    };

/** A decision model proposes routing only; it cannot authorize business actions. */
export type RoutingConfig =
  | { status: "off" }
  | {
      status: "ready";
      provider: RoutingProvider;
      modelId: string;
      apiKey: string | null;
      minProbability: number;
    }
  | {
      status: "unavailable";
      provider: string;
      modelId: string;
      problem: string;
    };

export type PayPalConfig =
  | { status: "fixture" }
  | {
      status: "ready";
      clientId: string;
      clientSecret: string;
      merchantId: string;
      webhookId: string;
    }
  | { status: "unavailable"; missing: string[] };

export type ServerConfig = {
  mode: AppMode;
  appUrl: string;
  authUrl: string;
  databaseKind: "postgres" | "d1";
  databaseUrl: string | null;
  databasePoolMax: number;
  authSecret: string;
  jobsSecret: string;
  /** Host key that encrypts credentials saved in Setup; absent means saving is unavailable. */
  settingsKey?: string;
  ai: AiConfig;
  routing: RoutingConfig;
  routineAi: AiConfig | null;
  /** How hard the assistant thinks before each step; unset keeps the provider default. */
  aiReasoning?: (typeof AI_REASONING_LEVELS)[number];
  /** US dollars the assistant may spend in total on this installation's key; unset means no dollar limit. */
  aiBudgetUsd?: number;
  /** "input,output" US dollars per million tokens, for a model the built-in price table does not list. */
  aiPricePerMillionTokens?: string;
  /** A public demo of Seller Desk itself: the home address is the Seller Desk home page, and the mode banner links to it. */
  publicDemo: boolean;
  /** The owner's desk assistant may read the PayPal account through PayPal's Agent Toolkit. Read-only. */
  paypalAgentToolkit: boolean;
  paypal: PayPalConfig;
  store: WooStoreConfig | null;
};

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Seller Desk configuration is invalid:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

function resolveAi(
  env: RawEnv,
  provider = env.AI_PROVIDER,
  selectedModel = env.AI_MODEL_ID,
): AiConfig {
  if (!provider) {
    return {
      status: "unavailable",
      provider: null,
      modelId: null,
      problem:
        "No AI model is connected yet. Set AI_PROVIDER, AI_MODEL_ID and that provider's key.",
    };
  }
  const modelId = selectedModel ?? null;
  if (!modelId) {
    return {
      status: "unavailable",
      provider,
      modelId: null,
      problem: `AI_MODEL_ID is required for provider ${provider}.`,
    };
  }
  const keyNames = PROVIDER_KEY_ENV[provider];
  const keyName = keyNames.find((name) => typeof env[name] === "string");
  if (!keyName) {
    return {
      status: "unavailable",
      provider,
      modelId,
      problem: `Missing credential for ${provider}: set ${keyNames.join(" or ")}.`,
    };
  }
  // Gateway on Vercel may authenticate with the deployment's OIDC token; the SDK reads it itself.
  const apiKey =
    keyName === "VERCEL_OIDC_TOKEN" ? null : (env[keyName] as string);
  return { status: "ready", provider, modelId, apiKey };
}

function resolveRouting(env: RawEnv): RoutingConfig {
  const provider =
    env.AI_ROUTING_PROVIDER ??
    (env.AI_PROVIDER === "gateway" || env.AI_PROVIDER === "openrouter"
      ? env.AI_PROVIDER
      : "off");
  if (provider === "off") return { status: "off" };
  const modelId =
    env.AI_ROUTING_MODEL_ID ??
    {
      gateway: "typesafe-ai/jev",
      openrouter: "typesafe/jev-1.13",
      typesafe: "jev-1.13.0",
      openai: "gpt-6-luna",
      anthropic: "claude-haiku-5-5",
    }[provider];
  if (provider === "openai" && modelId !== "gpt-6-luna") {
    return {
      status: "unavailable",
      provider,
      modelId,
      problem:
        "OpenAI Decisions currently requires gpt-6-luna. A Responses model is not interchangeable with a decision model.",
    };
  }
  if (provider === "typesafe") {
    return env.TYPESAFE_AI_API_KEY
      ? {
          status: "ready",
          provider,
          modelId,
          apiKey: env.TYPESAFE_AI_API_KEY,
          minProbability: env.AI_ROUTING_MIN_PROBABILITY,
        }
      : {
          status: "unavailable",
          provider,
          modelId,
          problem:
            "Add TYPESAFE_AI_API_KEY for Jev decisions. The reply model can still answer.",
        };
  }
  const config = resolveAi(env, provider, modelId);
  return config.status === "ready"
    ? {
        status: "ready",
        provider,
        modelId,
        apiKey: config.apiKey,
        minProbability: env.AI_ROUTING_MIN_PROBABILITY,
      }
    : { status: "unavailable", provider, modelId, problem: config.problem };
}

function resolvePayPal(env: RawEnv): PayPalConfig {
  if (env.APP_MODE === "fixture") return { status: "fixture" };
  const required = [
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID",
    "PAYPAL_WEBHOOK_ID",
  ] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) return { status: "unavailable", missing };
  return {
    status: "ready",
    clientId: env.PAYPAL_CLIENT_ID as string,
    clientSecret: env.PAYPAL_CLIENT_SECRET as string,
    merchantId: env.PAYPAL_MERCHANT_ID as string,
    webhookId: env.PAYPAL_WEBHOOK_ID as string,
  };
}

/** Parses an environment object. Exported for tests; the app uses getServerConfig(). */
export function parseServerConfig(
  source: Record<string, string | undefined>,
): ServerConfig {
  // Preview environment variables can inherit the production database. Refuse
  // the entire preview runtime rather than trusting a label as isolation proof.
  if (source.VERCEL === "1" && source.VERCEL_ENV === "preview") {
    throw new ConfigError(["Preview deployments are disabled. Use a separate Seller Desk project with its own database for testing."]);
  }
  // Vercel supplies the assigned deployment hostname before build and runtime.
  // An explicit APP_URL still wins; never derive an origin from an HTTP header.
  if (!source.APP_URL?.trim() && source.VERCEL === "1") {
    const host = source.VERCEL_ENV === "production"
      ? source.VERCEL_PROJECT_PRODUCTION_URL || source.VERCEL_URL
      : source.VERCEL_URL;
    // Both the generated hostname and a custom production domain are trusted
    // deployment metadata. URL syntax is still validated; request headers are not used.
    if (host && !/[\s/@?#:\\]/.test(host)) {
      const assigned = parseExactOrigin(`https://${host}`);
      if (assigned) source = { ...source, APP_URL: assigned };
    }
  }
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }
  const env = parsed.data;
  if (env.DATABASE_KIND === "postgres" && !env.DATABASE_URL)
    throw new ConfigError(["DATABASE_URL is required for PostgreSQL."]);
  if (env.DATABASE_KIND === "d1" && env.DATABASE_URL)
    throw new ConfigError([
      "D1 uses its native DB binding. Remove DATABASE_URL to prevent an ambiguous installation.",
    ]);
  let store: WooStoreConfig | null;
  try {
    store = parseWooStore(env.WOO_STORE_URL, env.APP_MODE);
  } catch {
    throw new ConfigError([
      "WOO_STORE_URL must be a public HTTPS WordPress installation URL without credentials, query or fragment. Local HTTP is only allowed in fixture mode.",
    ]);
  }
  return {
    store,
    mode: env.APP_MODE,
    appUrl: env.APP_URL,
    authUrl: env.BETTER_AUTH_URL ?? env.APP_URL,
    databaseKind: env.DATABASE_KIND,
    databaseUrl: env.DATABASE_URL ?? null,
    databasePoolMax: env.DATABASE_POOL_MAX,
    authSecret: env.BETTER_AUTH_SECRET,
    jobsSecret: env.JOBS_SECRET,
    ...(env.SETTINGS_ENCRYPTION_KEY ? { settingsKey: env.SETTINGS_ENCRYPTION_KEY } : {}),
    ai: resolveAi(env),
    routing: resolveRouting(env),
    routineAi:
      env.AI_ROUTINE_MODEL_ID || env.AI_ROUTINE_PROVIDER
        ? resolveAi(
            env,
            env.AI_ROUTINE_PROVIDER ?? env.AI_PROVIDER,
            env.AI_ROUTINE_MODEL_ID ?? "",
          )
        : null,
    paypal: resolvePayPal(env),
    publicDemo: env.PUBLIC_DEMO === "true",
    paypalAgentToolkit: env.PAYPAL_AGENT_TOOLKIT === "on",
    ...(env.AI_REASONING ? { aiReasoning: env.AI_REASONING } : {}),
    ...(env.AI_BUDGET_USD ? { aiBudgetUsd: env.AI_BUDGET_USD } : {}),
    ...(env.AI_PRICE_PER_MILLION_TOKENS ? { aiPricePerMillionTokens: env.AI_PRICE_PER_MILLION_TOKENS } : {}),
  };
}

let cached: ServerConfig | undefined;

/** The validated configuration for this process. Throws ConfigError when core settings are invalid. */
export function getServerConfig(): ServerConfig {
  const simulation = simulationConfig();
  if (simulation) return simulation;
  cached ??= parseServerConfig(process.env);
  return cached;
}

/** Test helper: forget the cached configuration after changing process.env. */
export function resetServerConfigForTests(): void {
  cached = undefined;
}
