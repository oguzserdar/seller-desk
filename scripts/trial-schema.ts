/** Generates the embedded trial schema from the same additive D1 migration bytes used by real installs. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { assertAdditiveD1Migration } from "./lib/d1-migrations";
const statements = readdirSync("drizzle-d1").filter(name => name.endsWith(".sql")).sort().flatMap(name => {
  const source = readFileSync(`drizzle-d1/${name}`, "utf8");
  assertAdditiveD1Migration(source, name);
  return source.split("--> statement-breakpoint").map(sql => sql.trim()).filter(Boolean);
});
const file = "src/server/simulation/trial-schema.ts";
const output = `/** Generated from drizzle-d1/*.sql by pnpm trial:schema. Do not edit. */\nexport const TRIAL_SCHEMA: readonly string[] = ${JSON.stringify(statements, null, 2)};\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== output) throw new Error("Trial schema is stale. Run pnpm trial:schema.");
} else writeFileSync(file, output);
