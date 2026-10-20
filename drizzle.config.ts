import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
  migrations: { prefix: "timestamp" },
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://localhost/seller_desk" },
});
