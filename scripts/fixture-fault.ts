/**
 * Arms one fixture fault so you can watch the app recover (fixture mode only).
 *
 *   pnpm fixture:fault                  lists the faults
 *   pnpm fixture:fault <name> [times]   arms it for the next <times> matching calls
 */
import { closeDb, getDb } from "../src/server/db/client";
import { armFault, FIXTURE_FAULTS, type FixtureFaultName } from "../src/fixtures/paypal-fixture";
import { loadLocalEnv } from "./lib/load-env";

loadLocalEnv();
if (process.env.APP_MODE !== "fixture") {
  console.error("Faults only exist in fixture mode.");
  process.exit(1);
}
const [name, times = "1"] = process.argv.slice(2);
if (!name) {
  console.log(`Faults: ${FIXTURE_FAULTS.join(", ")}`);
  process.exit(0);
}
if (!(FIXTURE_FAULTS as readonly string[]).includes(name) || !/^\d{1,2}$/.test(times)) {
  console.error(`Usage: pnpm fixture:fault <${FIXTURE_FAULTS.join("|")}> [times 1-99]`);
  process.exit(1);
}
try {
  await armFault(getDb(), name as FixtureFaultName, Number(times));
  console.log(`Armed ${name} for the next ${times} matching call${times === "1" ? "" : "s"}.`);
} finally {
  await closeDb();
}
