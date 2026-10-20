/** Deploy Button flow: migrate its provisioned binding, pin sandbox mode, then publish its own Worker. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { readD1Migrations } from "./lib/d1-migrations";
import { deployedWorkerAddress } from "./lib/worker-deployment";
// The Deploy Button must enforce the same additive-only gate as the operator migration path.
readD1Migrations("drizzle-d1");
const { values } = parseArgs({ options: { "secrets-file": { type: "string" } } });
function wrangler(args: string[], options: { output?: string; capture?: boolean; input?: string } = {}) {
  const child = spawnSync("pnpm", ["exec", "wrangler", ...args, "--config", "wrangler.jsonc"], {
    stdio: options.capture || options.input ? ["pipe", "pipe", "pipe"] : "inherit", encoding: "utf8",
    input: options.input, env: { ...process.env, ...(options.output ? { WRANGLER_OUTPUT_FILE_PATH: options.output } : {}) },
  });
  if (child.error || child.status !== 0) throw new Error(`Cloudflare installation stopped during ${args.slice(0, 2).join(" ")}; no later command ran.`);
  return child.stdout ?? "";
}
// Binding name is intentional: the Deploy Button can choose a different database name and ID.
wrangler(["d1", "migrations", "apply", "DB", "--remote"]);
wrangler(["d1", "execute", "DB", "--remote", "--command", "INSERT INTO installation(singleton, environment) VALUES (1, 'sandbox') ON CONFLICT(singleton) DO NOTHING"]);
const temporary = mkdtempSync(path.join(tmpdir(), "seller-desk-deployment-"));
try {
  const output = path.join(temporary, "deployment.jsonl");
  wrangler(["deploy", ...(values["secrets-file"] ? ["--secrets-file", values["secrets-file"]] : [])], { output });
  const deployed = deployedWorkerAddress(readFileSync(output, "utf8"));
  // Secret values cannot be retrieved. Inspect names only, and never overwrite an
  // existing canonical/custom-domain origin selected by this installation's owner.
  const names = JSON.parse(wrangler(["secret", "list", "--format", "json", "--name", deployed.name], { capture: true })) as { name: string }[];
  if (!names.some(secret => secret.name === "APP_URL")) {
    wrangler(["secret", "put", "APP_URL", "--name", deployed.name], { input: deployed.origin + "\n" });
  }
  console.log(`Seller Desk deployed: ${deployed.origin}. Open /owner/start to create your owner account.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
