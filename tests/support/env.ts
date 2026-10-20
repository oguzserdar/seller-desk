/** Runs in each test file before its imports execute: test settings only. */
import { resetServerConfigForTests } from "../../src/server/env";
import { assertTestDatabase, TEST_ENV } from "./test-env";
import { MotionGlobalConfig } from "motion/react";

// Arc components animate with Motion; tests check states, not motion, and cancelled animations reject on unmount.
MotionGlobalConfig.skipAnimations = true;
// happy-dom's Web Animations reject on cancel with no handler; without them Motion runs its own
// animations, which skipAnimations settles at once. Browser-like test files only.
if (typeof Element !== "undefined" && "animate" in Element.prototype) Reflect.deleteProperty(Element.prototype, "animate");

for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;
for (const key of ["AI_PROVIDER", "AI_MODEL_ID", "AI_ROUTING_PROVIDER", "AI_ROUTING_MODEL_ID", "AI_ROUTING_MIN_PROBABILITY", "AI_ROUTINE_PROVIDER", "AI_ROUTINE_MODEL_ID", "TYPESAFE_AI_API_KEY", "VERCEL_OIDC_TOKEN", "OPENAI_BASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]) {
  delete process.env[key];
}
assertTestDatabase(TEST_ENV.DATABASE_URL as string);
delete process.env.WOO_STORE_URL;
resetServerConfigForTests();
