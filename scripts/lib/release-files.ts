/**
 * The files a source release contains. The archive packs exactly this list and
 * the source guard scans exactly this list, so the two cannot drift apart.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const SKIP = new Set(["node_modules", ".next", ".vinext", ".cloudflare", ".wrangler", ".seller-desk", "release", "design", "test-results", "playwright-report", "blob-report", "coverage", "out", "dist", ".git", ".DS_Store"]);
const SKIP_FILE = /^\.env(?!\.example$)|^\.dev\.vars(?!\.example$)(?:\.|$)|\.tsbuildinfo$|^next-env\.d\.ts$|\.log$|\.private\.json$/;

function walk(root: string, rel: string, out: string[]) {
  for (const name of readdirSync(path.join(root, rel))) {
    if (SKIP.has(name)) continue;
    const file = rel ? path.join(rel, name) : name;
    // Historical captures include the removed scripted assistant. Preserve them
    // locally without presenting them as evidence in a new source release.
    if (file === path.join("docs", "evidence")) continue;
    if (statSync(path.join(root, file)).isDirectory()) walk(root, file, out);
    else if (!SKIP_FILE.test(name)) out.push(file);
  }
}

/** Release file paths relative to the repository root, sorted. */
export function releaseFiles(root = "."): string[] {
  const out: string[] = [];
  walk(root, "", out);
  return out.sort();
}
