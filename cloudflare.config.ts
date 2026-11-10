import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { loadEnv } from "vite";

const CORE = ["APP_MODE", "APP_URL", "BETTER_AUTH_SECRET", "JOBS_SECRET"];
const OPTIONAL = [
  "DATABASE_KIND",
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "BETTER_AUTH_URL",
  "AI_PROVIDER",
  "AI_MODEL_ID",
  "AI_ROUTING_PROVIDER",
  "AI_ROUTING_MODEL_ID",
  "AI_ROUTING_MIN_PROBABILITY",
  "AI_ROUTINE_PROVIDER",
  "AI_ROUTINE_MODEL_ID",
  "AI_BUDGET_USD",
  "AI_PRICE_PER_MILLION_TOKENS",
  "PUBLIC_DEMO",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_MERCHANT_ID",
  "PAYPAL_WEBHOOK_ID",
  "WOO_STORE_URL",
  "INSTALL_TOKEN",
  "CLIENT_IP_HEADER",
];
const PROVIDER_SETTINGS: Record<string, string[]> = {
  typesafe: ["TYPESAFE_AI_API_KEY"],
  gateway: ["AI_GATEWAY_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  openai: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
};

/** Loads operator settings for binding names only; never puts their values in build output. */
export function readCloudflareSettings(
  mode: string | undefined,
  root = process.cwd(),
): Record<string, string | undefined> {
  if (process.env.SELLER_DESK_INSTALL_BUILD === "1") return { ...process.env };
  const candidates = [
    mode ? path.join(root, `.dev.vars.${mode}`) : null,
    path.join(root, ".dev.vars"),
  ];
  const devVars = candidates.find((file) => file && existsSync(file));
  const local = devVars
    ? parseEnv(readFileSync(devVars, "utf8"))
    : loadEnv(mode ?? "production", root, "");
  return { ...local, ...process.env };
}

/** Declares core secrets and the configured integration's settings, without requiring unrelated keys. */
export function cloudflareSecretBindings(
  settings: Record<string, string | undefined>,
) {
  const main = settings.AI_PROVIDER?.trim() ?? "";
  const routing =
    settings.AI_ROUTING_PROVIDER?.trim() ||
    (["gateway", "openrouter"].includes(main) ? main : "off");
  const routine = settings.AI_ROUTINE_MODEL_ID?.trim()
    ? settings.AI_ROUTINE_PROVIDER?.trim() || main
    : "";
  const optional = [
    ...new Set([
      ...OPTIONAL,
      ...[main, routing, routine].flatMap(
        (provider) => PROVIDER_SETTINGS[provider] ?? [],
      ),
    ]),
  ];
  const names = [
    ...CORE,
    ...(settings.DATABASE_KIND === "d1" ? ["DATABASE_KIND"] : ["DATABASE_URL"]),
    ...optional.filter(
      (name) =>
        settings[name]?.trim() &&
        !(name === "DATABASE_URL" && settings.DATABASE_KIND === "d1"),
    ),
  ];
  return Object.fromEntries(
    [...new Set(names)].map((name) => [name, bindings.secret()]),
  );
}

import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";

/** Native databases are explicitly selected by UUID; a deploy cannot provision an accidental database. */
export function cloudflareDatabaseBindings(
  settings: Record<string, string | undefined>,
): Record<string, ReturnType<typeof bindings.d1>> {
  if (settings.DATABASE_KIND !== "d1") return {};
  if (settings.SELLER_DESK_INSTALL_BUILD === "1") return { DB: bindings.d1({ name: "seller-desk-install", dev: { remote: false } }) };
  const database = (key: string) => {
    const id = settings[key];
    if (!id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
      throw new Error(`${key} must name an existing D1 database UUID.`);
    return bindings.d1({ id, dev: { remote: false } });
  };
  return {
    DB: database("D1_DATABASE_ID"),
  };
}
export default defineConfig(({ mode }) => {
  const settings = readCloudflareSettings(mode);
  const name = settings.SELLER_DESK_INSTALL_BUILD === "1" ? "seller-desk-install" : "seller-desk";
  const worker = defineWorker({
      name,
      entrypoint: "./src/worker.ts",
      compatibilityDate: "2026-10-09",
      compatibilityFlags: ["nodejs_compat"],
      assets: { notFoundHandling: "none" },
      // CUSTOM_DOMAIN in the deploy settings publishes the Worker on the operator's own domain as well.
      // The workers.dev address stays on, so old links still arrive and are sent to the shop's address.
      ...(settings.CUSTOM_DOMAIN?.trim() ? { domains: [settings.CUSTOM_DOMAIN.trim()], workersDev: true } : {}),
      triggers: [triggers.scheduled({ schedule: "* * * * *" })],
      exports: { SimulationDatabase: exports.durableObject({ storage: "sqlite" }) },
      env: {
        ASSETS: bindings.assets(),
        SIMULATIONS: bindings.durableObject({ worker: name, exportName: "SimulationDatabase" }),
        ...cloudflareSecretBindings(settings),
        ...cloudflareDatabaseBindings(settings),
      },
    });
  return { worker };
});
