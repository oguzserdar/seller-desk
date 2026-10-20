/** Prevent shipping a stale plugin ZIP or packaging private, unreviewed files. */
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";

it("ships exactly the current plugin sources and MIT license", () => {
  const entries = unzipSync(readFileSync("public/downloads/seller-desk-widget.zip"));
  const files = ["LICENSE", "readme.txt", "seller-desk-widget.php", "settings-page.php", "settings.css", "settings.js"];
  expect(Object.keys(entries).sort()).toEqual(files.map((file) => `seller-desk-widget/${file}`));
  for (const file of files) {
    const bytes = entries[`seller-desk-widget/${file}`];
    if (!bytes) throw new Error(`Missing plugin file: ${file}`);
    expect(Buffer.from(bytes)).toEqual(readFileSync(`integrations/wordpress/seller-desk-widget/${file}`));
  }
  expect(readFileSync("integrations/wordpress/seller-desk-widget/LICENSE", "utf8")).toContain("MIT License");
});
