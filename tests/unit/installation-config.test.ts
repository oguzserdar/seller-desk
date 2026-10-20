import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseServerConfig } from "@/server/env";
import { TEST_ENV } from "../support/test-env";

describe("Vercel assigned deployment origin", () => {
  it("uses the production alias and refuses preview runtime configuration", () => {
    const settings = { ...TEST_ENV, APP_URL: "", VERCEL: "1", VERCEL_URL: "seller-desk-unique.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "seller-desk.vercel.app" };
    expect(parseServerConfig({ ...settings, VERCEL_ENV: "production" }).appUrl).toBe("https://seller-desk.vercel.app");
    expect(() => parseServerConfig({ ...settings, VERCEL_ENV: "preview" })).toThrow("Preview deployments are disabled");
    expect(() => parseServerConfig({ ...settings, APP_URL: TEST_ENV.APP_URL, VERCEL_ENV: "preview" })).toThrow("Preview deployments are disabled");
  });
  it("accepts a trusted custom production domain while keeping explicit origins", () => {
    expect(parseServerConfig({ ...TEST_ENV, APP_URL: "", VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "desk.example.test" }).appUrl).toBe("https://desk.example.test");
  });
  it("keeps explicit origins and refuses missing or malformed platform hostname values", () => {
    expect(parseServerConfig({ ...TEST_ENV, VERCEL: "1", VERCEL_URL: "other.vercel.app" }).appUrl).toBe(TEST_ENV.APP_URL);
    for (const host of ["seller.vercel.app/anything", "seller.vercel.app@attacker.example", "seller.vercel.app?bad=true", ""]) expect(() => parseServerConfig({ ...TEST_ENV, APP_URL: "", VERCEL: "1", VERCEL_URL: host })).toThrow("APP_URL");
    expect(() => parseServerConfig({ ...TEST_ENV, APP_URL: "", VERCEL_URL: "seller.vercel.app" })).toThrow("APP_URL");
  });
});

// An override of plain pnpm install makes Vercel select its oldest pnpm.
// This project needs the declared pnpm 10 patch-hash format, not pnpm 6/9.
it("the deployment button enables the pinned manager before Vercel's dependency install", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  expect(config).not.toHaveProperty("installCommand");
  const link = readFileSync("README.md", "utf8").match(/\]\((https:\/\/vercel\.com\/new\/clone\?[^)]+)\)/)?.[1];
  expect(link).toBeTruthy();
  const query = new URL(link!).searchParams;
  expect(query.get("env")?.split(",")).toContain("ENABLE_EXPERIMENTAL_COREPACK");
  expect(JSON.parse(query.get("envDefaults")!)).toHaveProperty("ENABLE_EXPERIMENTAL_COREPACK", "1");
});
