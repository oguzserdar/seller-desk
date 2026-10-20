/**
 * AI provider wiring without a network: each of the five native providers is
 * built from its own key and sends requests only to its own service; unknown
 * or incomplete settings stop with a reason instead of falling back.
 */
import { describe, expect, it } from "vitest";
import { PROVIDER_FACTORIES } from "@/server/ai/registry";
import { ConfigError, parseServerConfig } from "@/server/env";

const BASE = {
  APP_MODE: "sandbox",
  APP_URL: "https://shop.example.test",
  DATABASE_URL: "postgresql://localhost:5432/unused",
  BETTER_AUTH_SECRET: "a".repeat(40),
  JOBS_SECRET: "b".repeat(40),
};

const KEYS = {
  AI_GATEWAY_API_KEY: "key-for-gateway",
  OPENROUTER_API_KEY: "key-for-openrouter",
  OPENAI_API_KEY: "key-for-openai",
  ANTHROPIC_API_KEY: "key-for-anthropic",
  GOOGLE_GENERATIVE_AI_API_KEY: "key-for-google",
};

const CASES = [
  { provider: "gateway", modelId: "openai/gpt-5-mini", key: KEYS.AI_GATEWAY_API_KEY, host: "ai-gateway.vercel.sh" },
  { provider: "openrouter", modelId: "openai/gpt-5-mini", key: KEYS.OPENROUTER_API_KEY, host: "openrouter.ai" },
  { provider: "openai", modelId: "gpt-5-mini", key: KEYS.OPENAI_API_KEY, host: "api.openai.com" },
  { provider: "anthropic", modelId: "claude-sonnet-5-5", key: KEYS.ANTHROPIC_API_KEY, host: "api.anthropic.com" },
  { provider: "google", modelId: "gemini-3.1-flash", key: KEYS.GOOGLE_GENERATIVE_AI_API_KEY, host: "generativelanguage.googleapis.com" },
] as const;

type CallableModel = { provider: string; modelId: string; doGenerate: (options: unknown) => Promise<unknown> };

/** Records every request the model tries to send, answering each with a refusal. */
async function requestsOf(model: CallableModel): Promise<{ url: string; text: string }[]> {
  const seen: { url: string; text: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = JSON.stringify([...new Headers(init?.headers).entries()]);
    seen.push({ url, text: `${url} ${headers} ${typeof init?.body === "string" ? init.body : ""}` });
    return new Response(JSON.stringify({ error: { message: "refused by test" } }), { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] }).catch(() => undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
}

describe("AI provider wiring", () => {
  it("reads only the selected provider's key", () => {
    for (const c of CASES) {
      const ai = parseServerConfig({ ...BASE, ...KEYS, AI_PROVIDER: c.provider, AI_MODEL_ID: c.modelId }).ai;
      expect(ai).toMatchObject({ status: "ready", provider: c.provider, modelId: c.modelId, apiKey: c.key });
    }
  });

  for (const c of CASES) {
    it(`${c.provider}: sends the request to its own service with only its own key`, async () => {
      const model = PROVIDER_FACTORIES[c.provider](c.key, c.modelId) as unknown as CallableModel;
      const requests = await requestsOf(model);
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) expect(new URL(request.url).host).toBe(c.host);
      const all = requests.map((request) => request.text).join("\n");
      expect(all).toContain(c.key);
      expect(all).toContain(c.modelId);
      for (const other of Object.values(KEYS)) if (other !== c.key) expect(all).not.toContain(other);
    });
  }

  it("a missing key stops the assistant with a reason and never falls back to the stand-in", () => {
    const ai = parseServerConfig({ ...BASE, OPENAI_API_KEY: KEYS.OPENAI_API_KEY, AI_PROVIDER: "anthropic", AI_MODEL_ID: "claude-sonnet-5-5" }).ai;
    expect(ai).toMatchObject({ status: "unavailable", provider: "anthropic" });
    expect(ai.status === "unavailable" ? ai.problem : "").toContain("ANTHROPIC_API_KEY");
  });

  it("an unknown provider is a configuration error", () => {
    expect(() => parseServerConfig({ ...BASE, AI_PROVIDER: "mistral", AI_MODEL_ID: "x" })).toThrow(ConfigError);
  });

  it("a real provider needs a model id", () => {
    expect(parseServerConfig({ ...BASE, ...KEYS, AI_PROVIDER: "openai" }).ai).toMatchObject({ status: "unavailable", provider: "openai" });
  });

  it("there is no stand-in model: 'fixture' is not a provider, and demo mode has no assistant until a real one is set", () => {
    expect(() => parseServerConfig({ ...BASE, AI_PROVIDER: "fixture" })).toThrow(ConfigError);
    expect(parseServerConfig({ ...BASE, APP_MODE: "fixture" }).ai.status).toBe("unavailable");
  });

  it("Gateway on Vercel may use the deployment's OIDC token instead of a key", () => {
    const ai = parseServerConfig({ ...BASE, AI_PROVIDER: "gateway", AI_MODEL_ID: "openai/gpt-5-mini", VERCEL_OIDC_TOKEN: "oidc-token" }).ai;
    expect(ai).toMatchObject({ status: "ready", provider: "gateway", apiKey: null });
  });
});
