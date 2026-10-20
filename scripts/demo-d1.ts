/** One-command persistent local D1 demo. Never opens PostgreSQL or mutates a cloud account. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { FIXTURE_OWNER_EMAIL, seedShop } from "../src/fixtures/seed";
import { withD1Database } from "../src/server/request-scope";
import { createD1Db } from "../src/server/storage/d1/client";
import { openD1Maintenance } from "./lib/d1-maintenance";
import { applyD1Migrations } from "./lib/d1-runner";
const { values } = parseArgs({
  options: { port: { type: "string" }, "setup-only": { type: "boolean" } },
});
const file = ".dev.vars.d1",
  state = path.resolve(".seller-desk/d1");
let app: ChildProcess | undefined,
  timer: ReturnType<typeof setInterval> | undefined;
try {
  if (!existsSync(file)) {
    const port = Number(values.port ?? "4310");
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Choose a port from 1024 to 65535.");
    writeFileSync(
      file,
      [
        "# Local fictional D1 shop. Never commit this file.",
        "APP_MODE=fixture",
        `APP_URL=http://localhost:${port}`,
        "DATABASE_KIND=d1",
        `D1_DATABASE_ID=${randomUUID()}`,
        "D1_LOCAL_STATE_PATH=.seller-desk/d1",
        `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
        `JOBS_SECRET=${randomBytes(32).toString("base64url")}`,
        "AI_PROVIDER=anthropic",
        "AI_MODEL_ID=claude-sonnet-5-5",
        "AI_ROUTING_PROVIDER=off",
        "ANTHROPIC_API_KEY=",
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );
  } else if (values.port)
    throw new Error(
      "Existing D1 settings were preserved. Change APP_URL in .dev.vars.d1 to change its port.",
    );
  const settings = parseEnv(readFileSync(file, "utf8"));
  if (settings.APP_MODE !== "fixture" || settings.DATABASE_KIND !== "d1")
    throw new Error("The local D1 demo requires its own fixture settings.");
  const origin = new URL(settings.APP_URL ?? "");
  if (origin.protocol !== "http:" || origin.hostname !== "localhost")
    throw new Error("The local demo requires a localhost HTTP address.");
  for (const [name, value] of Object.entries(settings))
    process.env[name] = value;
  delete process.env.DATABASE_URL;
  const target = {
    mode: "local" as const,
    databaseId: settings.D1_DATABASE_ID ?? "",
    persistTo: state,
  };
  await applyD1Migrations(path.resolve("drizzle-d1"), target);
  const connection = await openD1Maintenance(target);
  try {
    await connection.binding
      .prepare(
        "insert into installation(environment) select 'fixture' where not exists(select 1 from seller) and not exists(select 1 from user) on conflict(singleton) do nothing",
      )
      .run();
    const marker = await connection.binding
      .prepare("select environment from installation")
      .first<{ environment: string }>();
    if (marker?.environment !== "fixture")
      throw new Error(
        "The existing database is not a fixture shop. Nothing was reset.",
      );
    const result = await withD1Database(createD1Db(connection.binding), () =>
      seedShop({ preset: "showcase", origins: [] }),
    );
    if (result.outcome === "seeded" && result.fixturePassword) {
      mkdirSync(".seller-desk", { recursive: true, mode: 0o700 });
      writeFileSync(
        ".seller-desk/d1-demo-owner.private.json",
        JSON.stringify(
          { email: FIXTURE_OWNER_EMAIL, password: result.fixturePassword },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
    }
  } finally {
    await connection.close();
  }
  console.log(
    `D1 shop ready. Buyer: ${origin.origin}/buy. Owner: ${origin.origin}/owner/login. Local demo login: .seller-desk/d1-demo-owner.private.json. AI needs a real provider key in .dev.vars.d1. All existing records were preserved.`,
  );
  if (!values["setup-only"]) {
    let stopping = false;
    const stop = () => {
      stopping = true;
      app?.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(
      "Building the local D1 app, then opening its production preview.",
    );
    app = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "build", "--mode", "d1"],
      { stdio: "inherit", env: process.env },
    );
    const built = await new Promise<number>((resolve, reject) => {
      app!.once("error", reject);
      app!.once("exit", (code) => resolve(code ?? 1));
    });
    if (stopping)
      throw new Error("D1 demo stopped. Existing records remain saved.");
    if (built !== 0)
      throw new Error(
        "The D1 app build failed. No server was started; existing data was preserved.",
      );
    app = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--mode",
        "d1",
        "--host",
        "localhost",
        "--port",
        origin.port || "80",
        "--strictPort",
      ],
      { stdio: "inherit", env: process.env },
    );
    let working = false;
    timer = setInterval(() => {
      if (working) return;
      working = true;
      void fetch(`${origin.origin}/api/jobs/reconcile`, {
        method: "POST",
        headers: { authorization: `Bearer ${settings.JOBS_SECRET}` },
        signal: AbortSignal.timeout(50000),
      })
        .catch(() => {})
        .finally(() => {
          working = false;
        });
    }, 60000);
    process.exitCode = await new Promise<number>((resolve, reject) => {
      app!.once("error", reject);
      app!.once("exit", (code) => resolve(code ?? 0));
    });
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Local D1 demo failed.",
  );
  process.exitCode = 1;
} finally {
  if (timer) clearInterval(timer);
  if (app?.exitCode === null) app.kill("SIGTERM");
}
