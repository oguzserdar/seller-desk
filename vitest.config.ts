import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real PostgreSQL database (TEST_DATABASE_URL,
 * default: the local cluster's seller_desk_test). Files run one at a time
 * because they share that database; concurrency inside a test is real.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    setupFiles: ["tests/support/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
