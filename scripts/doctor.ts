/**
 * Checks this installation and says what to fix, in plain words.
 *
 *   pnpm run doctor            (plain `pnpm doctor` runs pnpm's own built-in check instead)
 *   pnpm run doctor -- --live  also checks real model tool use and structured output
 *
 * It never prints secrets: only whether each one is set.
 */
import { count, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import pg from "pg";
import { parseOriginList } from "../src/lib/origin";
import { verifyAiSetup } from "../src/server/ai/setup-check";
import { closeDb, getDb } from "../src/server/db/client";
import { offer, seller, user } from "../src/server/db/schema";
import { ConfigError, getServerConfig } from "../src/server/env";
import { loadLocalEnv } from "./lib/load-env";

type Result = { ok: boolean | "warn"; label: string; detail: string };
const results: Result[] = [];
const check = (ok: Result["ok"], label: string, detail: string) =>
  results.push({ ok, label, detail });

const live = process.argv.includes("--live");
const files = loadLocalEnv();
const major = Number(process.versions.node.split(".")[0]);
check(
  major >= 24 ? true : "warn",
  "Node",
  `${process.versions.node}${major >= 24 ? "" : " (24 or newer is supported)"}`,
);
check(
  files.length > 0 ? true : "warn",
  "Settings file",
  files.length > 0
    ? files.join(", ")
    : "none found; run `pnpm demo` or copy .env.example to .env.local",
);

let config: ReturnType<typeof getServerConfig> | null = null;
try {
  config = getServerConfig();
  check(true, "Settings", `APP_MODE=${config.mode}, APP_URL=${config.appUrl}`);
} catch (error) {
  check(
    false,
    "Settings",
    error instanceof ConfigError ? error.problems.join("; ") : String(error),
  );
}

if (config) {
  if (config.databaseKind === "d1") {
    check(
      "warn",
      "Database",
      "Use pnpm d1:admin --task doctor with an explicit D1 destination. No PostgreSQL connection was attempted.",
    );
  } else {
    const client = new pg.Client({
      connectionString: config.databaseUrl!,
      connectionTimeoutMillis: 5000,
    });
    let reachable = false;
    try {
      await client.connect();
      reachable = true;
      const journal = JSON.parse(
        readFileSync("drizzle/meta/_journal.json", "utf8"),
      ) as { entries: unknown[] };
      const applied = await client
        .query("select count(*)::int as n from drizzle.__drizzle_migrations")
        .catch(() => ({ rows: [{ n: 0 }] }));
      const n = applied.rows[0]?.n ?? 0;
      check(
        n === journal.entries.length,
        "Database",
        n === journal.entries.length
          ? `reachable, all ${n} migrations applied`
          : `${n} of ${journal.entries.length} migrations applied; run \`pnpm db:migrate\``,
      );
      const mode = await client
        .query("select environment from installation limit 1")
        .catch(() => ({ rows: [] as { environment: string }[] }));
      const environment = mode.rows[0]?.environment;
      check(
        environment === config.mode,
        "Database mode",
        environment
          ? `${environment} database${environment === config.mode ? "" : `, but APP_MODE=${config.mode}: use separate databases`}`
          : "not set; run `pnpm db:migrate`",
      );
    } catch (error) {
      check(
        false,
        "Database",
        `cannot connect: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      await client.end().catch(() => {});
    }

    if (reachable) {
      try {
        const db = getDb();
        const [shop] = await db.select().from(seller).limit(1);
        const [published] = await db
          .select({ n: count() })
          .from(offer)
          .where(eq(offer.published, true));
        const [owners] = await db.select({ n: count() }).from(user);
        check(
          Boolean(shop),
          "Shop",
          shop
            ? shop.displayName
            : "none yet; run `pnpm db:seed` (demo) or `pnpm owner:bootstrap`",
        );
        check(
          (owners?.n ?? 0) > 0,
          "Owner account",
          (owners?.n ?? 0) > 0 ? "exists" : "none; run `pnpm owner:bootstrap`",
        );
        check(
          (published?.n ?? 0) > 0 ? true : "warn",
          "Published offers",
          `${published?.n ?? 0}`,
        );
        const origins = parseOriginList(shop?.allowedOrigins ?? []).valid;
        check(
          origins.length > 0 ? true : "warn",
          "Widget websites",
          origins.length > 0
            ? origins.join(", ")
            : "none; the widget stays hidden everywhere (add sites under Setup)",
        );
      } catch (error) {
        check(
          false,
          "Shop data",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        await closeDb();
      }
    }
  }
  const ai = config.ai;
  if (ai.status !== "ready")
    check(
      "warn",
      "AI model",
      `${ai.problem} The shop works without the assistant.`,
    );
  else if (!live)
    check(
      "warn",
      "AI model",
      `${ai.modelId} through ${ai.provider}, credential configured. Not yet tested: run \`pnpm run doctor -- --live\` to check tool use and reply format.`,
    );
  else {
    const result = await verifyAiSetup();
    check(
      result.ok,
      "AI model",
      result.ok
        ? `${result.detail} (${result.latencyMs} ms).`
        : `${ai.modelId} through ${ai.provider} did not pass: ${result.problem}`,
    );
  }
  const paypal = config.paypal;
  check(
    config.mode === "fixture" ? true : paypal.status === "ready",
    "PayPal",
    config.mode === "fixture"
      ? "demo PayPal (no real payments)"
      : paypal.status === "ready"
        ? "sandbox credentials set"
        : paypal.status === "unavailable"
          ? `missing: ${paypal.missing.join(", ")}`
          : "not configured for sandbox",
  );
}

const width = Math.max(...results.map((r) => r.label.length));
for (const r of results)
  console.log(
    `${r.ok === true ? "ok  " : r.ok === "warn" ? "note" : "FIX "}  ${r.label.padEnd(width)}  ${r.detail}`,
  );
const failed = results.filter((r) => r.ok === false).length;
console.log(
  failed === 0
    ? "\nNothing to fix."
    : `\n${failed} thing${failed === 1 ? "" : "s"} to fix above.`,
);
process.exitCode = failed === 0 ? 0 : 1;
