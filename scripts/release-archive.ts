/**
 * Packs the source for publication into release/seller-desk-<stamp>.tar.gz.
 *
 *   pnpm release:archive
 *
 * Leaves out everything that must not ship: settings files with secrets, local
 * databases and logs (.seller-desk), dependencies, build output, test artifacts
 * and the design-process folder (tool logs, unprocessed renders). Runs the
 * source guard first and stops if it finds anything.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { releaseFiles } from "./lib/release-files";

const guard = spawnSync("pnpm", ["exec", "tsx", "scripts/source-guard.ts"], { stdio: "inherit" });
if (guard.status !== 0) process.exit(guard.status ?? 1);

const files = releaseFiles();
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
mkdirSync("release", { recursive: true });
const list = path.join("release", `files-${stamp}.txt`);
writeFileSync(list, `${files.join("\n")}\n`);
const archive = path.join("release", `seller-desk-${stamp}.tar.gz`);
execFileSync("tar", ["-czf", archive, "-T", list], {
  // macOS otherwise adds AppleDouble files containing filesystem metadata.
  env: { ...process.env, COPYFILE_DISABLE: "1", LC_ALL: "C" },
});
console.log(`${archive}: ${files.length} files, ${(statSync(archive).size / 1024).toFixed(0)} KB. File list: ${list}`);
