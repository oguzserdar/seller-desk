/** CLI orchestration contracts, with an explicitly synthetic infrastructure process. No hosted or AI success is claimed. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TEST_ENV } from "../support/test-env";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "seller-installer-contract-"));
  for (const file of ["src", "scripts", "drizzle-d1", "package.json", "tsconfig.json"]) cpSync(file, path.join(directory, file), { recursive: true });
  symlinkSync(path.resolve("node_modules"), path.join(directory, "node_modules"));
  mkdirSync(path.join(directory, "bin"));
  writeFileSync(path.join(directory, "bin/pnpm"), `#!/usr/bin/env node
import fs from 'node:fs'; const args=process.argv.slice(2); fs.appendFileSync(process.env.INSTALL_CONTRACT_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='exec'&&args[1]==='wrangler'){
 if(args[2]==='deploy')fs.appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({type:'deploy',version:1,worker_name:'renamed-test-shop',targets:[process.env.INSTALL_CONTRACT_ORIGIN||'https://renamed-test-shop.account-example.workers.dev']})+'\\n');
 if(args[2]==='secret'&&args[3]==='list')console.log(JSON.stringify(process.env.INSTALL_CONTRACT_EXISTING==='1'?[{name:'APP_URL'}]:[]));
 if(args[2]==='secret'&&args[3]==='put'){let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>fs.writeFileSync(process.env.INSTALL_CONTRACT_LOG+'.origin',text));}
}
`, { mode: 0o755 });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function invoke(script: string, extra: Record<string, string> = {}) {
  const child = spawnSync(process.execPath, ["--import", "tsx", script], { cwd: directory, env: { ...process.env, ...TEST_ENV, VERCEL: "1", VERCEL_ENV: "production", PATH: `${path.join(directory, "bin")}:${process.env.PATH}`, INSTALL_CONTRACT_LOG: path.join(directory, "calls.jsonl"), ...extra }, encoding: "utf8", timeout: 30_000 });
  const file = path.join(directory, "calls.jsonl");
  return { child, calls: existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]) : [] };
}
it("migrates the binding, deploys, then records the actual renamed Worker address only when missing", () => {
  const { child, calls } = invoke("scripts/deploy-cloudflare-install.ts");
  expect(child.status, child.stderr).toBe(0);
  expect(calls.map(args => args.slice(2, 5))).toEqual([["d1", "migrations", "apply"], ["d1", "execute", "DB"], ["deploy", "--config", "wrangler.jsonc"], ["secret", "list", "--format"], ["secret", "put", "APP_URL"]]);
  expect(calls.at(-1)).toContain("renamed-test-shop");
  expect(readFileSync(path.join(directory, "calls.jsonl.origin"), "utf8")).toBe("https://renamed-test-shop.account-example.workers.dev\n");
});
it("preserves an existing canonical origin and refuses an invalid new destination", () => {
  let result = invoke("scripts/deploy-cloudflare-install.ts", { INSTALL_CONTRACT_EXISTING: "1" });
  expect(result.child.status, result.child.stderr).toBe(0); expect(result.calls.some(args => args[2] === "secret" && args[3] === "put")).toBe(false);
  rmSync(path.join(directory, "calls.jsonl"));
  result = invoke("scripts/deploy-cloudflare-install.ts", { INSTALL_CONTRACT_ORIGIN: "https://wrong.example.test" });
  expect(result.child.status).not.toBe(0); expect(result.calls.some(args => args[2] === "secret")).toBe(false);
});
it("rejects a destructive migration before any remote command is attempted", () => {
  writeFileSync(path.join(directory, "drizzle-d1/9999_destructive.sql"), "DROP TABLE seller;");
  const { child, calls } = invoke("scripts/deploy-cloudflare-install.ts");
  expect(child.status).not.toBe(0); expect(calls).toEqual([]);
});
it("runs automatic PostgreSQL migrations only in production, never for a Vercel preview", () => {
  let result = invoke("scripts/build-vercel.ts", { VERCEL_ENV: "preview" });
  expect(result.child.status).not.toBe(0); expect(result.calls).toEqual([]);
  expect(result.child.stderr).toContain("Preview deployments are disabled");
  result = invoke("scripts/build-vercel.ts", { VERCEL_ENV: "production" });
  expect(result.child.status, result.child.stderr).toBe(0); expect(result.calls).toEqual([["db:migrate"], ["build"]]);
});
