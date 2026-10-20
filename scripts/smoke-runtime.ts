/**
 * @fileoverview Checks that production-rendered pages show runtime AI settings,
 * including routes that otherwise prerender. Run against an existing server.
 * @module scripts/smoke-runtime
 */
import { parseArgs } from "node:util";
import assert from "node:assert/strict";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://localhost:4310" }, model: { type: "string" } } });
if (!values.model) throw new Error("Pass --model with the model configured in the running server.");
for (const path of ["/buy", `/order/${crypto.randomUUID()}`, "/checkout/return", "/checkout/cancel"]) {
  const response = await fetch(new URL(path, values.base));
  const html = await response.text();
  assert.equal(response.status, 200, `${path} must render`);
  assert.ok(html.includes(`AI model: ${values.model}.`), `${path} has stale AI configuration`);
  assert.ok(!html.includes("AI assistant not connected."), `${path} falsely says AI is disconnected`);
  console.log(`${path}: current model displayed`);
}
