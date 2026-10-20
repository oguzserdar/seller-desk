/**
 * Runs one bounded recovery pass locally (payments to check, download grants,
 * failed webhook events).  Usage: pnpm jobs:run
 */
import { closeDb } from "../src/server/db/client";
import { runDueWork } from "../src/server/jobs/run";
import { loadLocalEnv } from "./lib/load-env";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";

loadLocalEnv();
const { values } = parseArgs({ options: { watch: { type: "boolean" } } });
const stopped = new AbortController();
process.once("SIGINT", () => stopped.abort());
process.once("SIGTERM", () => stopped.abort());
try {
  do {
    const summary = await runDueWork("cli", { signal: stopped.signal });
    if (!values.watch || summary.paymentsChecked + summary.grantsTried + summary.webhooksProcessed + summary.conversationsResumed > 0 || summary.problems.length > 0) console.log(JSON.stringify(summary, null, 2));
    if (!values.watch) break;
    await setTimeout(30_000, undefined, { signal: stopped.signal }).catch(() => {});
  } while (!stopped.signal.aborted);
} finally {
  await closeDb();
}
