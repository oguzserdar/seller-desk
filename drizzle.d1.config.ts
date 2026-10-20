import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/sqlite/schema.ts",
  out: "./drizzle-d1",
  strict: true,
});
