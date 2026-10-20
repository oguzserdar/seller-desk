import { createD1Db } from "@/server/storage/d1/client";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assertAdditiveD1Migration } from "../../scripts/lib/d1-migrations";

/** A real local Workers runtime and D1 binding, isolated per acceptance fixture. */
export async function newD1TestDatabase() {
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "seller-desk-acceptance",
          compatibilityDate: "2026-10-06",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents:
                  "export default { fetch() { return new Response('test'); } };",
              },
            },
          },
          env: { DB: { type: "d1", id: crypto.randomUUID() } },
        },
      },
    ],
  });
  try {
    const binding = await runtime.getD1Database("DB");
    // The application baseline contains additive schema only. D1's native exec
    // has separate statement parsing from prepared bindings, so use the runner's
    // validated bytes with exec for schema creation, never application writes.
    for (const name of readdirSync("drizzle-d1")
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const source = readFileSync(path.join("drizzle-d1", name), "utf8");
      assertAdditiveD1Migration(source, name);
      const statements = source
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      // Keep schema setup native without a separate HTTP round trip for every table and index.
      for (let start = 0; start < statements.length; start += 24) {
        await binding.batch(
          statements
            .slice(start, start + 24)
            .map((statement) => binding.prepare(statement)),
        );
      }
    }
    return {
      runtime,
      binding,
      db: createD1Db(binding),
      close: () => runtime.dispose(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
