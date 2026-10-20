import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { cloudflareTrialFactory } from "@/server/simulation/cloudflare-sqlite";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";

/** Executes the real Durable Object class in workerd, not a JavaScript stand-in. */
export async function newTrialDurableObject() {
  const directory = mkdtempSync(path.join(tmpdir(), "seller-trial-runtime-"));
  try {
    const output = path.join(directory, "worker.js");
    execFileSync("node_modules/.bin/esbuild", ["src/server/simulation/cloudflare-sqlite.ts", "--bundle", "--format=esm", "--platform=neutral", "--packages=external", `--outfile=${output}`], { stdio: "pipe" });
    const source = readFileSync(output, "utf8");
    const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
      name: "trial-acceptance", compatibilityDate: "2026-10-09", compatibilityFlags: ["nodejs_compat"],
      exports: { SimulationDatabase: { type: "durable-object", storage: "sqlite" } },
      env: { SIMULATIONS: { type: "durable-object", worker: "trial-acceptance", exportName: "SimulationDatabase" } },
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: source } } },
    } }] });
    try {
      const namespace = await runtime.getDurableObjectNamespace("SIMULATIONS") as unknown as DurableObjectNamespace;
      return { factory: cloudflareTrialFactory(namespace), close: async () => { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); } };
    } catch (error) { await runtime.dispose(); throw error; }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
