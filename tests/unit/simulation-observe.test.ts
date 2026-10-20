/** Stream/error boundaries only; these tests do not supply a successful assistant reply. */
import { expect, it } from "vitest";
import { observeSimulationResponse, simulationText, simulationTranscript } from "@/server/simulation/observe";

it("does not convert HTTP or stream errors into successful assistant text", async () => {
  expect(await observeSimulationResponse(new Response("private provider body", { status: 429 }))).toEqual({ message: null, failed: true });
  const response = new Response('data: {"type":"error","errorText":"private failure"}\n\ndata: [DONE]\n\n');
  const observed = await observeSimulationResponse(response);
  expect(observed.failed).toBe(true); expect(JSON.stringify(observed)).not.toContain("private failure");
});

it("removes capability links and tokens without including raw tool outputs", () => {
  expect(simulationText("Visit https://example.test/access?token=secret or secret", "secret")).toBe("Visit [link omitted] or [private session]");
  const report = simulationTranscript([{ id: "test", role: "user", parts: [{ type: "text", text: "Please inspect https://example.test/private" }] }], "secret");
  expect(report).toEqual({ transcript: [{ role: "user", text: "Please inspect [link omitted]" }], tools: [] });
});
