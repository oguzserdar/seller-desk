/**
 * @fileoverview Exercises the demo installer with an isolated, newly created
 * PostgreSQL cluster, invalid host locale, repeat setup and a migration failure.
 * @module tests/installation/demo
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { availablePort } from "../../scripts/lib/local-demo-db";

it("initializes without external PostgreSQL, preserves settings, and reports later failures with a nonzero exit", async () => {
  const root = process.cwd();
  const isolated = mkdtempSync(path.join(tmpdir(), "seller-desk-install-test-"));
  for (const file of ["src", "scripts", "drizzle", "package.json", "tsconfig.json"]) cpSync(path.join(root, file), path.join(isolated, file), { recursive: true });
  symlinkSync(path.join(root, "node_modules"), path.join(isolated, "node_modules"), "dir");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(APP_|DATABASE_|TEST_DATABASE_|BETTER_AUTH_|JOBS_|SELLER_DESK_|AI_|OPENAI_|OPENROUTER_|ANTHROPIC_|GOOGLE_GENERATIVE_AI_|PAYPAL_|VERCEL_OIDC)/.test(key)) delete env[key];
  }
  env.LANG = "invalid_locale_for_regression";
  env.NEXT_TELEMETRY_DISABLED = "1";
  const demo = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/demo.ts", ...args], { cwd: isolated, env, encoding: "utf8", timeout: 45_000 });
  const setup = () => demo(["--setup-only"]);
  try {
    const first = demo(["--setup-only", "--port", String(await availablePort())]);
    // Do not print stdout on failure: first setup prints a generated demo password.
    expect({ status: first.status, signal: first.signal, error: first.error?.message }).toEqual({ status: 0, signal: null, error: undefined });
    expect(first.stdout).toContain("Setup complete");
    const original = readFileSync(path.join(isolated, ".env.local"), "utf8");
    expect(statSync(path.join(isolated, ".env.local")).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(isolated, ".seller-desk/postgres/PG_VERSION"), "utf8").trim()).toBe("18");
    const second = setup();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Your existing shop was preserved");
    expect(readFileSync(path.join(isolated, ".env.local"), "utf8") === original).toBe(true);
    writeFileSync(path.join(isolated, "scripts/jobs-run.ts"), "process.exit(23);\n");
    const workerFailure = demo([]);
    expect(workerFailure.status).toBe(1);
    expect(workerFailure.stderr).toContain("The recovery worker stopped");
    expect(setup().status).toBe(0); // The failed run released its database process.
    renameSync(path.join(isolated, "drizzle"), path.join(isolated, "migrations-deliberately-unavailable"));
    const failed = setup();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("failed");
    expect(readFileSync(path.join(isolated, ".env.local"), "utf8") === original).toBe(true);
  } finally { rmSync(isolated, { recursive: true, force: true }); }
}, 120_000);
