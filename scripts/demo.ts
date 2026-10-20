/**
 * Starts a local fictional shop, PostgreSQL and the recovery worker with one command.
 * Existing settings and shop data are preserved. AI requires a real provider.
 * Usage: pnpm demo [--setup-only] [--port 4310] [--database-url postgresql://...]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-env";
import { availablePort, startLocalDatabase } from "./lib/local-demo-db";

const { values } = parseArgs({ options: { "database-url": { type: "string" }, "setup-only": { type: "boolean" }, port: { type: "string" } } });
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) throw new Error("Seller Desk needs Node 24 or newer.");
const ENV_FILE = ".env.local";
let stopDatabase: (() => Promise<void>) | undefined;
let app: ChildProcess | undefined;
let worker: ChildProcess | undefined;

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    const done = () => { clearTimeout(timer); resolve(); };
    child.once("exit", done);
    child.once("error", done);
    child.kill("SIGTERM");
  });
}

function run(script: string): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${script} failed. Fix the reported problem and run pnpm demo again.`);
}

try {
  loadLocalEnv();
  if (!existsSync(ENV_FILE)) {
    const port = Number(values.port ?? "4310");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose an app port between 1024 and 65535.");
    const supplied = values["database-url"] ?? process.env.DATABASE_URL;
    const databaseUrl = supplied ?? `postgresql://seller_desk:${randomBytes(24).toString("base64url")}@127.0.0.1:${await availablePort()}/seller_desk_demo`;
    new URL(databaseUrl);
    writeFileSync(ENV_FILE, [
      "# Local fictional shop. Never commit this file.",
      "APP_MODE=fixture",
      `APP_URL=http://localhost:${port}`,
      `DATABASE_URL=${JSON.stringify(databaseUrl)}`,
      ...(supplied ? [] : ["SELLER_DESK_LOCAL_DATABASE=1"]),
      `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
      `JOBS_SECRET=${randomBytes(32).toString("base64url")}`,
      "AI_PROVIDER=gateway",
      "AI_MODEL_ID=anthropic/claude-sonnet-5.5",
      "AI_ROUTING_PROVIDER=gateway",
      "AI_GATEWAY_API_KEY=",
      "",
    ].join("\n"), { mode: 0o600, flag: "wx" });
    console.log("Created private local settings. PayPal is simulated; AI stays disconnected until you configure a provider.");
    loadLocalEnv();
  } else if (values.port || values["database-url"]) {
    throw new Error("This checkout already has .env.local. Edit that file to change its address; the demo never overwrites existing settings.");
  }
  if (process.env.APP_MODE !== "fixture") throw new Error("The demo only opens APP_MODE=fixture. Use a separate checkout and database for PayPal sandbox.");
  const appUrl = new URL(process.env.APP_URL ?? "");
  if (appUrl.protocol !== "http:" || appUrl.hostname !== "localhost") throw new Error("The local demo needs APP_URL=http://localhost:<port>.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL or use a fresh checkout for an automatically managed local database.");
  if (process.env.SELLER_DESK_LOCAL_DATABASE === "1") {
    console.log("Starting this checkout's private PostgreSQL database…");
    stopDatabase = await startLocalDatabase(databaseUrl, async () => {
      await Promise.all([stopChild(app), stopChild(worker)]);
    });
  }
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("select 1");
  } catch {
    throw new Error("Could not reach the configured PostgreSQL database. Check DATABASE_URL and the database service. Your settings were preserved.");
  } finally { await client.end().catch(() => {}); }

  run("scripts/db-migrate.ts");
  run("scripts/db-seed.ts");
  if (values["setup-only"]) {
    console.log("Setup complete. Run pnpm demo to start the shop and its recovery worker.");
  } else {
    console.log(`\nShop: ${appUrl.origin}/buy\nOwner desk: ${appUrl.origin}/owner/login\nPress Ctrl+C to stop. Your shop data will remain saved.\n`);
    app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", appUrl.port || "80"], { stdio: "inherit" });
    worker = spawn(process.execPath, ["--import", "tsx", "scripts/jobs-run.ts", "--watch"], { stdio: "inherit" });
    let stopping = false;
    const stopChildren = () => { stopping = true; app?.kill("SIGTERM"); worker?.kill("SIGTERM"); };
    process.once("SIGINT", stopChildren);
    process.once("SIGTERM", stopChildren);
    const code = await new Promise<number>((resolve, reject) => {
      app!.once("error", reject);
      worker!.once("error", reject);
      worker!.once("exit", () => {
        if (!stopping) {
          console.error("The recovery worker stopped. Restart pnpm demo after fixing its reported error.");
          stopChildren();
          resolve(1);
        }
      });
      app!.once("exit", (status, signal) => resolve(stopping ? 0 : signal ? 1 : status ?? 1));
    });
    process.exitCode = code;
    worker.kill("SIGTERM");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The local demo could not start. Check that its ports are free and the database is accessible.");
  process.exitCode = 1;
} finally {
  await Promise.all([stopChild(app), stopChild(worker)]);
  if (stopDatabase) await stopDatabase();
}

// The database package's beforeExit hook otherwise replaces a failure code with zero.
process.exit(process.exitCode ?? 0);
