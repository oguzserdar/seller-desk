/** Internal D1 migration preparation. Full D1 installation remains unavailable until backend parity. */
import path from "node:path";
import { parseArgs } from "node:util";
import { applyD1Migrations, type D1MigrationTarget } from "./lib/d1-runner";
import { readD1Migrations } from "./lib/d1-migrations";

const { values } = parseArgs({ options: {
  check: { type: "boolean" }, local: { type: "boolean" }, remote: { type: "boolean" },
  dir: { type: "string", default: "drizzle-d1" }, "database-id": { type: "string" },
  "account-id": { type: "string" }, "persist-to": { type: "string" },
} });

try {
  const directory = path.resolve(values.dir!);
  if (values.check) {
    if (values.local || values.remote) throw new Error("Use --check alone to validate SQL without execution.");
    const files = readD1Migrations(directory);
    console.log(`D1 migration guard: ${files.length} additive migration(s) checked. Nothing applied.`);
  } else {
    if (Boolean(values.local) === Boolean(values.remote)) throw new Error("Choose exactly one: --local or --remote. Nothing runs by default.");
    const target: D1MigrationTarget = values.local
      ? { mode: "local", databaseId: values["database-id"] ?? "", persistTo: values["persist-to"] ?? "" }
      : { mode: "remote", databaseId: values["database-id"] ?? "", accountId: values["account-id"] ?? "" };
    const result = await applyD1Migrations(directory, target);
    console.log(result.output);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "D1 migration failed.");
  process.exitCode = 1;
}
