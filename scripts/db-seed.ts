/**
 * Loads a fictional seller preset into an EMPTY shop.
 *
 *   pnpm db:seed                    showcase preset (goods, service and digital)
 *   pnpm db:seed --preset goods     also: service, digital
 *
 * Never overwrites: if the shop already has offers, it stops without changes.
 * In fixture mode with no owner yet, it creates a fixture-only owner and prints
 * its generated password once. That account must never be used for real data.
 */
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../src/server/db/client";
import { installation } from "../src/server/db/schema";
import { PRESET_KEYS, PRESETS, type PresetKey } from "../src/fixtures/presets";
import { FIXTURE_OWNER_EMAIL, seedShop } from "../src/fixtures/seed";
import { loadLocalEnv } from "./lib/load-env";

loadLocalEnv();
const { values } = parseArgs({ options: { preset: { type: "string", default: "showcase" }, origin: { type: "string", multiple: true } } });
const presetKey = values.preset as PresetKey;
if (!PRESET_KEYS.includes(presetKey)) {
  console.error(`Unknown preset "${values.preset}". Choose one of: ${PRESET_KEYS.join(", ")}.`);
  process.exit(1);
}

try {
  const [installed] = await getDb().select().from(installation);
  if (!installed) throw new Error("The database is not migrated. Run `pnpm db:migrate` first.");
  const origins = values.origin ?? ["http://localhost:4311"];
  const result = await seedShop({ preset: presetKey, origins });
  if (result.outcome === "not_empty") {
    console.log("This shop already has offers. Your existing shop was preserved.");
  } else {
    const preset = PRESETS[presetKey];
    console.log(`Seeded "${preset.sellerName}" (${preset.key} preset, fictional): ${result.offers} published offers.`);
    console.log(`Widget origins allowed: ${origins.join(", ")}`);
    if (result.fixturePassword) {
      console.log("");
      console.log("Fixture owner (local fixture database only; shown once, never use for real data):");
      console.log(`  email:    ${FIXTURE_OWNER_EMAIL}`);
      console.log(`  password: ${result.fixturePassword}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
