/** Build the same source-only WordPress ZIP on every machine. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { zipSync, type Zippable } from "fflate";

const files = ["seller-desk-widget.php", "settings-page.php", "settings.js", "settings.css", "readme.txt", "LICENSE"];
const entries: Zippable = {};
// ZIP dates use local calendar fields. A fixed local date keeps bytes identical across zones.
const mtime = new Date(2026, 0, 1, 0, 0, 0);
for (const name of files) {
  entries[`seller-desk-widget/${name}`] = [await readFile(`integrations/wordpress/seller-desk-widget/${name}`), { mtime }];
}
const archive = zipSync(entries, { level: 9 });
await mkdir("public/downloads", { recursive: true });
await writeFile("public/downloads/seller-desk-widget.zip", archive);
console.log(`WordPress plugin: ${archive.length} bytes; SHA-256 ${createHash("sha256").update(archive).digest("hex")}`);
