import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Loads `.env.local` (then `.env`) into process.env for CLI scripts, the same
 * files Next.js reads. Values already set in the shell win.
 */
export function loadLocalEnv(root = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (existsSync(file)) {
      process.loadEnvFile(file);
      loaded.push(name);
    }
  }
  return loaded;
}

/** Reads a required variable or exits with a plain message. */
export function requireVar(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. Run \`pnpm demo\` for a local fixture setup, or copy .env.example to .env.local.`);
    process.exit(1);
  }
  return value;
}
