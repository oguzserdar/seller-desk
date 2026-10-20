import { describe, expect, it } from "vitest";
import { cloudflareSecretBindings } from "../../cloudflare.config";
import { parseServerConfig } from "../../src/server/env";
import { TEST_ENV } from "../support/test-env";

/** Cloudflare translates each secret binding into a required deployment secret. */
function missingDeclaredSecrets(settings: Record<string, string>): string[] {
  return Object.entries(cloudflareSecretBindings(settings))
    .filter(([name, binding]) => binding.type === "secret" && !settings[name])
    .map(([name]) => name);
}

describe("Cloudflare installation settings", () => {
  it("can install with core settings while AI remains visibly disconnected", () => {
    expect(parseServerConfig(TEST_ENV).ai.status).toBe("unavailable");
    expect(missingDeclaredSecrets(TEST_ENV)).toEqual([]);
  });

  it("does not require other providers when a seller chooses OpenRouter", () => {
    const settings = {
      ...TEST_ENV,
      AI_PROVIDER: "openrouter",
      AI_MODEL_ID: "test-model",
      OPENROUTER_API_KEY: "test-only-key",
    };
    expect(parseServerConfig(settings).ai).toMatchObject({
      status: "ready",
      provider: "openrouter",
    });
    expect(missingDeclaredSecrets(settings)).toEqual([]);
  });

  it("declares only secret names, never values or credentials for an unselected provider", () => {
    const settings = {
      ...TEST_ENV,
      AI_PROVIDER: "openai",
      AI_MODEL_ID: "test-model",
      OPENAI_API_KEY: "private-openai-key",
      OPENAI_BASE_URL: "https://provider.example/v1",
      ANTHROPIC_API_KEY: "unselected-key",
    };
    const bindings = cloudflareSecretBindings(settings);
    expect(bindings.OPENAI_API_KEY).toEqual({ type: "secret" });
    expect(bindings.OPENAI_BASE_URL).toEqual({ type: "secret" });
    expect(bindings.ANTHROPIC_API_KEY).toBeUndefined();
    expect(JSON.stringify(bindings)).not.toContain("private-openai-key");
    expect(JSON.stringify(bindings)).not.toContain("https://provider.example");
  });

  it("includes credentials for independently selected decision and routine providers", () => {
    const bindings = cloudflareSecretBindings({
      ...TEST_ENV,
      AI_PROVIDER: "anthropic",
      AI_MODEL_ID: "main",
      ANTHROPIC_API_KEY: "reply-key",
      AI_ROUTING_PROVIDER: "typesafe",
      TYPESAFE_AI_API_KEY: "decision-key",
      AI_ROUTINE_PROVIDER: "openai",
      AI_ROUTINE_MODEL_ID: "routine",
      OPENAI_API_KEY: "routine-key",
      OPENROUTER_API_KEY: "unused-key",
    });
    for (const name of [
      "ANTHROPIC_API_KEY",
      "TYPESAFE_AI_API_KEY",
      "OPENAI_API_KEY",
      "AI_ROUTING_PROVIDER",
      "AI_ROUTINE_MODEL_ID",
    ])
      expect(bindings[name]).toEqual({ type: "secret" });
    expect(bindings.OPENROUTER_API_KEY).toBeUndefined();
    expect(JSON.stringify(bindings)).not.toContain("-key");
  });

  it("still refuses an installation without its core authentication secret", () => {
    expect(() =>
      parseServerConfig({ ...TEST_ENV, BETTER_AUTH_SECRET: undefined }),
    ).toThrow("BETTER_AUTH_SECRET");
  });

  it.each(["openai", "anthropic"])(
    "includes the independently selected %s decision key without unrelated credentials",
    (provider) => {
      const keyName =
        provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      const bindings = cloudflareSecretBindings({
        ...TEST_ENV,
        AI_PROVIDER: "google",
        AI_MODEL_ID: "reply",
        GOOGLE_GENERATIVE_AI_API_KEY: "reply-key",
        AI_ROUTING_PROVIDER: provider,
        [keyName]: "decision-key",
        TYPESAFE_AI_API_KEY: "unused-key",
      });
      expect(bindings[keyName]).toEqual({ type: "secret" });
      expect(bindings.TYPESAFE_AI_API_KEY).toBeUndefined();
      expect(JSON.stringify(bindings)).not.toContain("decision-key");
    },
  );
});

it("D1 declares only native bindings and does not require or accept a PostgreSQL URL", async () => {
  const { cloudflareDatabaseBindings } = await import(
    "../../cloudflare.config"
  );
  const settings = {
    ...TEST_ENV,
    DATABASE_KIND: "d1",
    DATABASE_URL: "",
    D1_DATABASE_ID: "00000000-0000-0000-0000-000000000001",
  };
  expect(parseServerConfig(settings)).toMatchObject({
    databaseKind: "d1",
    databaseUrl: null,
  });
  expect(cloudflareSecretBindings(settings)).not.toHaveProperty("DATABASE_URL");
  expect(cloudflareDatabaseBindings(settings)).toMatchObject({
    DB: { type: "d1", id: settings.D1_DATABASE_ID },
  });
  expect(() =>
    parseServerConfig({ ...settings, DATABASE_URL: TEST_ENV.DATABASE_URL }),
  ).toThrow(/ambiguous/);
  expect(() =>
    cloudflareDatabaseBindings({ ...settings, D1_DATABASE_ID: "" }),
  ).toThrow(/UUID/);
});


it("does not promote an ambient local PostgreSQL URL into a D1 Worker secret", () => {
  const inherited: Record<string, string> = { ...TEST_ENV, DATABASE_KIND: "d1" };
  expect(inherited.DATABASE_URL).toBeTruthy();
  expect(cloudflareSecretBindings(inherited)).not.toHaveProperty("DATABASE_URL");
  expect(cloudflareSecretBindings({ ...inherited, DATABASE_KIND: "postgres" }))
    .toHaveProperty("DATABASE_URL", { type: "secret" });
  expect(() => parseServerConfig(inherited)).toThrow(/ambiguous/);
});
