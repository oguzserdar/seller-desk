/**
 * @fileoverview Keeps the managed database alive until dependent clients close
 * when a normal stop signal triggers the database package's exit hook.
 * @module tests/installation/shutdown
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { availablePort } from "../../scripts/lib/local-demo-db";

it.each(["SIGINT", "SIGTERM"] as const)("closes clients before PostgreSQL on %s", async (signal) => {
  const root = process.cwd();
  const isolated = mkdtempSync(path.join(tmpdir(), "seller-desk-shutdown-test-"));
  const port = await availablePort();
  const helper = path.join(root, "scripts/lib/local-demo-db.ts");
  symlinkSync(path.join(root, "node_modules"), path.join(isolated, "node_modules"), "dir");
  writeFileSync(path.join(isolated, "probe.mts"), `
    import pg from "pg";
    import { setTimeout } from "node:timers/promises";
    import { startLocalDatabase } from ${JSON.stringify(helper)};
    const url = "postgresql://seller_desk:test-only-password@127.0.0.1:${port}/seller_desk_demo";
    const client = new pg.Client({ connectionString: url });
    client.on("error", () => console.log("DATABASE_CLOSED_EARLY"));
    const stop = await startLocalDatabase(url, async () => {
      await setTimeout(250);
      await client.query("select 1");
      await client.end();
      console.log("CLIENT_CLOSED_FIRST");
    });
    await client.connect();
    console.log("READY");
    // The application's own signal handler and dependency exit hook both stop.
    process.once(${JSON.stringify(signal)}, () => void stop());
  `);
  const child = spawn(process.execPath, ["--import", "tsx", "probe.mts"], { cwd: isolated, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let sent = false;
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (!sent && output.includes("READY")) { sent = true; child.kill(signal); }
  });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("close", () => resolve());
      child.once("error", reject);
    });
    expect(sent).toBe(true);
    expect(output).toContain("CLIENT_CLOSED_FIRST");
    expect(output.match(/CLIENT_CLOSED_FIRST/g)).toHaveLength(1);
    expect(output).not.toContain("DATABASE_CLOSED_EARLY");
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    expect(reachable).toBe(false);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(isolated, { recursive: true, force: true });
  }
}, 20_000);
