/** Vercel's installation build: validate settings, migrate the explicitly selected PostgreSQL database, then build Next.js. */
import { spawnSync } from "node:child_process";
import { parseServerConfig } from "../src/server/env";

if (process.env.VERCEL !== "1") throw new Error("Use pnpm build locally. This installation build is reserved for Vercel.");
const config = parseServerConfig(process.env);
if (config.databaseKind !== "postgres") throw new Error("Vercel installations require a separate PostgreSQL database.");
function run(script: string) {
  const child = spawnSync("pnpm", [script], { stdio: "inherit", env: process.env });
  if (child.error || child.status !== 0) throw new Error(`${script} did not finish. The deployment was stopped.`);
}
// Preview configuration is refused above, before any database command or build.
if (process.env.VERCEL_ENV === "production") run("db:migrate");
run("build");
