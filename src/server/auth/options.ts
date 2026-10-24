import type { BetterAuthOptions } from "better-auth";
import { connectorPlugins } from "./connector";

/**
 * Better Auth options that decide which auth tables exist.
 *
 * Shared by the runtime auth instance and by `scripts/generate-auth-schema.ts`,
 * so the generated Drizzle schema always matches what the server expects.
 * Secrets, database and plugins are added at runtime in `auth.ts`.
 */
export const authSchemaOptions = {
  emailAndPassword: {
    enabled: true,
    // One owner per installation. Owners are created by `pnpm owner:bootstrap`,
    // never through a public sign-up route.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      // Registration is open to any AI app, so it gets the tightest limit.
      "/oauth2/register": { window: 60, max: 5 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
  },
  // The connector's tables (keys, AI apps, tokens, consents). The URL only shapes runtime
  // behaviour, so the schema is the same for every installation; auth.ts passes the real one.
  plugins: connectorPlugins("https://seller-desk.invalid"),
} satisfies Partial<BetterAuthOptions>;
