/**
 * @fileoverview Integration tests for the Insights analyst turn route.
 * @module tests/integration/insights-turn
 *
 * A public-demo visitor may ask the analyst, but on its own small allowance per address,
 * never on the owner's limits; oversized and malformed turns are refused before any model call.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/owner/insights/turn/route";
import { VIEWER_COOKIE, issueViewerPass } from "@/server/auth/viewer-pass";
import { resetServerConfigForTests } from "@/server/env";
import { resetShop } from "../support/shop";

beforeEach(async () => {
  await resetShop();
  vi.stubEnv("PUBLIC_DEMO", "true");
  resetServerConfigForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerConfigForTests();
});

async function ask(body: unknown, address = "203.0.113.7") {
  const pass = await issueViewerPass();
  const request = new Request("https://shop.test/api/owner/insights/turn", {
    method: "POST",
    headers: { cookie: `${VIEWER_COOKIE}=${pass}`, "x-forwarded-for": address, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await POST(request);
  return { status: response.status, body: (await response.json()) as { message?: string } };
}

const turn = { messages: [{ role: "user", content: "What sold best?" }] };

it("gives demo visitors their own allowance per address, separate from the owner's", async () => {
  for (let index = 0; index < 12; index += 1) {
    const result = await ask(turn);
    expect(result.body.message ?? "").not.toMatch(/resting/);
  }
  const limited = await ask(turn);
  expect(limited.body.message).toMatch(/demo analyst is resting/);
  // Another visitor's address still has its own allowance.
  expect((await ask(turn, "198.51.100.9")).body.message ?? "").not.toMatch(/resting/);
});

it("refuses a turn too large to be the dashboard's own conversation", async () => {
  const result = await ask({ instructions: "x".repeat(170_000), messages: [{ role: "user", content: "hi" }] });
  expect(result.status).toBe(400);
  expect(result.body.message).toMatch(/too long/);
});
