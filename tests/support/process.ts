import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TEST_ENV } from "./test-env";

const run = promisify(execFile);

/** Runs a TypeScript entry point as a separate Node process against the test database; returns its last JSON line. */
export async function runInNewProcess<T>(script: string, args: string[] = []): Promise<T> {
  const { stdout } = await run(process.execPath, ["--import", "tsx", script, ...args], { env: { ...process.env, ...TEST_ENV }, timeout: 60_000 });
  const line = stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  if (!line) throw new Error(`no JSON output from ${script}: ${stdout}`);
  return JSON.parse(line) as T;
}
