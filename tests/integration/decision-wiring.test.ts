import { experimental_decide } from "ai";
import { describe, expect, it } from "vitest";
import { DECISION_FACTORIES } from "../../src/server/ai/routing";
import { handlingQuestion } from "../../src/server/ai/routing-policy";

/** Actual SDK request serialization, with explicit network refusal, never a fabricated AI answer. */
describe("native decision provider network boundaries", () => {
  for (const provider of ["gateway", "openrouter", "typesafe", "openai", "anthropic"] as const) {
    it(`${provider} sends only its selected credential and makes no retry`, async () => {
      const seen: { url: string; body: string; headers: string }[] = [];
      const key = `test-only-${provider}`;
      const transport: typeof fetch = async (input, init) => {
        seen.push({ url: String(input), headers: JSON.stringify([...new Headers(init?.headers).entries()]), body: String(init?.body) });
        return new Response(JSON.stringify({ error: { message: "refused by transport test" } }), { status: 401, headers: { "content-type": "application/json" } });
      };
      const modelId = { gateway: "typesafe-ai/jev", openrouter: "typesafe/jev-1.13", typesafe: "jev-1.13.0", openai: "gpt-6-luna", anthropic: "claude-haiku-5-5" }[provider];
      await expect(experimental_decide({ model: DECISION_FACTORIES[provider](key, modelId, transport), questions: handlingQuestion("buyer"), state: { message: "Hello" }, maxRetries: 0 })).rejects.toBeDefined();
      expect(seen).toHaveLength(1); expect(seen[0]!.headers).toContain(key); expect(JSON.stringify(seen[0])).toContain(modelId);
      expect(seen[0]!.url).toContain({ gateway: "ai-gateway.vercel.sh", openrouter: "openrouter.ai", typesafe: "typesafe", openai: "api.openai.com/v1/decisions", anthropic: "api.anthropic.com/v1/messages" }[provider]);
      expect(seen[0]!.body).toContain("Hello");
      if (provider === "openrouter") expect(JSON.parse(seen[0]!.body).state).toEqual({ message: "Hello" });
      if (provider === "anthropic") expect(JSON.parse(seen[0]!.body).output_config.format.type).toBe("json_schema");
      for (const other of ["gateway", "openrouter", "typesafe", "openai", "anthropic"]) if (other !== provider) expect(JSON.stringify(seen)).not.toContain(`test-only-${other}`);
    });
  }

  it("rejects unsupported OpenRouter image state before making a request", async () => {
    let calls = 0;
    const transport: typeof fetch = async () => { calls++; throw new Error("No request expected"); };
    await expect(experimental_decide({ model: DECISION_FACTORIES.openrouter("test-only-key", "typesafe/jev-1.13", transport),
      state: [{ type: "file", mediaType: "image/png", data: new Uint8Array([137, 80, 78, 71]) }],
      questions: handlingQuestion("buyer"), maxRetries: 0 })).rejects.toThrow("text and JSON state only");
    expect(calls).toBe(0);
  });
});
