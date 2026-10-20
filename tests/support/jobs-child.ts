/**
 * A freshly started app process that runs one recovery pass and exits: the
 * restart in "restart recovery". It reads only the environment it is given.
 */
import { closeDb } from "../../src/server/db/client";
import { runDueWork } from "../../src/server/jobs/run";

try {
  console.log(JSON.stringify(await runDueWork("test")));
} finally {
  await closeDb();
}
