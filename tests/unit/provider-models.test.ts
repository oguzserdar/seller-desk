import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModels } from "@/server/ai/provider-models";

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe("listing a provider's models", () => {
  it("reads Anthropic's list with the key in its own header", async () => {
    const fetchMock = respond(200, { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", type: "model" }] });
    expect(await listProviderModels("anthropic", "sk-ant-key")).toEqual({ ok: true, models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ant-key", "anthropic-version": "2023-06-01" });
  });

  it("keeps only OpenAI chat models", async () => {
    respond(200, { data: [{ id: "gpt-5-mini" }, { id: "text-embedding-3-small" }, { id: "gpt-4o-realtime-preview" }, { id: "o4-mini" }, { id: "dall-e-3" }] });
    const result = await listProviderModels("openai", "sk-key");
    expect(result.ok && result.models.map((m) => m.id)).toEqual(["o4-mini", "gpt-5-mini"]);
  });

  it("keeps only Gemini models that generate content", async () => {
    respond(200, { models: [
      { name: "models/gemini-3.1-flash", displayName: "Gemini 3.1 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ] });
    expect(await listProviderModels("google", "AIza-key")).toEqual({ ok: true, models: [{ id: "gemini-3.1-flash", label: "Gemini 3.1 Flash" }] });
  });

  it("keeps only OpenRouter models that support tools", async () => {
    respond(200, { data: [
      { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", supported_parameters: ["tools", "temperature"] },
      { id: "some/no-tools-model", name: "No tools", supported_parameters: ["temperature"] },
    ] });
    const result = await listProviderModels("openrouter", "sk-or-key");
    expect(result.ok && result.models.map((m) => m.id)).toEqual(["anthropic/claude-sonnet-5.5"]);
  });

  it("says the key was refused and never passes the provider's body on", async () => {
    respond(401, { error: { message: "invalid x-api-key sk-ant-secret" } });
    const result = await listProviderModels("anthropic", "sk-ant-secret");
    expect(result).toEqual({ ok: false, problem: "The provider refused this key." });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports other failures with the status only", async () => {
    respond(500, { error: "boom" });
    expect(await listProviderModels("openai", "sk-key")).toEqual({ ok: false, problem: "The provider could not list models (HTTP 500)." });
  });
});
