/**
 * The release list is what ships publicly and what the source guard scans, so
 * private settings, local evidence and design-process files must never appear in it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { releaseFiles } from "../../scripts/lib/release-files";

const root = mkdtempSync(path.join(tmpdir(), "release-files-"));
const put = (file: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), "x");
};
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("release files", () => {
  it("ships source and the example settings, and nothing private or local", () => {
    for (const file of ["src/app/page.tsx", "README.md", ".env.example", ".dev.vars.example", "docs/readiness.md"]) put(file);
    for (const file of [".env", ".env.local", ".dev.vars", "preview-token.private.json", "docs/evidence/shot.png", "design/photos/mug/codex.log", ".seller-desk/private-terms.txt", ".wrangler/state/v3/d1/shop.sqlite", "node_modules/x/index.js", "release/old.tar.gz", "run.log"]) put(file);
    expect(releaseFiles(root)).toEqual([".dev.vars.example", ".env.example", "README.md", "docs/readiness.md", "src/app/page.tsx"]);
  });
});
