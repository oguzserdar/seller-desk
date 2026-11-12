/**
 * Better Auth for the single owner: email + password with database sessions.
 * Every endpoint this app does not use is disabled, including public sign-up,
 * password recovery and social linking. Owners are created by the
 * `pnpm owner:bootstrap` CLI through Better Auth's own internal adapter.
 */
import { getDb } from "@/server/db/client";
import * as pgAuthSchema from "@/server/db/auth-schema";
import * as d1AuthSchema from "@/server/db/sqlite/auth-schema";
import { getServerConfig } from "@/server/env";
import { getRequestScope } from "@/server/request-scope";
import type { D1Db } from "@/server/storage/d1/client";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { connectorHooks, connectorPlugins } from "./connector";
import { reportingDatabaseErrors } from "./adapter-errors";
import { authSchemaOptions } from "./options";

/** Endpoints that stay reachable: sign in, sign out, read the session, health. */
export const ENABLED_AUTH_PATHS = [
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/ok",
  "/error",
] as const;

/** Every other endpoint shipped by Better Auth 1.7.7 (read from the installed source). */
export const DISABLED_AUTH_PATHS = [
  "/account-info",
  "/callback/:id",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/social",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

function createAuth(database?: BetterAuthOptions["database"]) {
  const config = getServerConfig();
  return betterAuth({
    ...authSchemaOptions,
    appName: "Seller Desk",
    baseURL: config.authUrl,
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    database:
      database ??
      reportingDatabaseErrors(
        drizzleAdapter(getDb(), {
          provider: "pg",
          // Every auth table, as on D1: the connector's plugins read the OAuth tables too.
          schema: pgAuthSchema,
        }),
      ),
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    disabledPaths: DISABLED_AUTH_PATHS,
    advanced: {
      ...authSchemaOptions.advanced,
      useSecureCookies: config.appUrl.startsWith("https://"),
      cookiePrefix: "seller-desk",
      // The client's address from the host's trusted header (same rule as clientKey in usage.ts):
      // CLIENT_IP_HEADER per host (cf-connecting-ip on Cloudflare), else x-forwarded-for, which Vercel sets.
      ipAddress: { ipAddressHeaders: [process.env.CLIENT_IP_HEADER?.toLowerCase() || "x-forwarded-for"] },
    },
    telemetry: { enabled: false },
    hooks: connectorHooks,
    plugins: [...connectorPlugins(config.appUrl), nextCookies()],
  });
}

/** Creates the same owner-only authentication service on a native D1 adapter. */
export function createD1Auth(db: D1Db) {
  return createAuth(
    reportingDatabaseErrors(drizzleAdapter(db, { provider: "sqlite", schema: d1AuthSchema })),
  );
}

/** Owner authentication service with this installation's disabled-endpoint policy. */
export type SellerDeskAuth = ReturnType<typeof createAuth>;

const holder = globalThis as unknown as { __sellerDeskAuth?: SellerDeskAuth };

/** Keeps the database adapter within the database connection's lifetime. */
export function getAuth(): SellerDeskAuth {
  const scope = getRequestScope();
  if (scope)
    return (scope.auth ??= scope.d1 ? createD1Auth(scope.d1) : createAuth());
  holder.__sellerDeskAuth ??= createAuth();
  return holder.__sellerDeskAuth;
}
