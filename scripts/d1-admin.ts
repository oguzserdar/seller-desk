/** Explicit operator-only D1 maintenance. No HTTP bootstrap route, global login edits or implicit destination. */
import { eq } from "drizzle-orm";
import { parseArgs } from "node:util";
import { PRESETS, type PresetKey } from "../src/fixtures/presets";
import { seedShop } from "../src/fixtures/seed";
import {
  bootstrapOwner,
  resetOwnerPassword,
} from "../src/server/auth/bootstrap";
import { installation, offer, seller } from "../src/server/db/sqlite/schema";
import { getServerConfig } from "../src/server/env";
import { runDueWork } from "../src/server/jobs/run";
import { withD1Database } from "../src/server/request-scope";
import { createD1Db } from "../src/server/storage/d1/client";
import { openD1Maintenance } from "./lib/d1-maintenance";
import { loadLocalEnv } from "./lib/load-env";
import { ask, askHidden, readStdin } from "./lib/prompt";
loadLocalEnv();
const { values } = parseArgs({
  options: {
    task: { type: "string" },
    local: { type: "boolean" },
    remote: { type: "boolean" },
    "database-id": { type: "string" },
    "account-id": { type: "string" },
    "persist-to": { type: "string" },
    mode: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    country: { type: "string" },
    currency: { type: "string" },
    preset: { type: "string", default: "showcase" },
    "password-stdin": { type: "boolean" },
  },
});
let connection: Awaited<ReturnType<typeof openD1Maintenance>> | undefined;
try {
  if (Boolean(values.local) === Boolean(values.remote))
    throw new Error(
      "Choose exactly one explicit destination: --local or --remote.",
    );
  if (
    !["install", "owner", "reset-password", "seed", "doctor", "jobs"].includes(
      values.task ?? "",
    )
  )
    throw new Error(
      "Choose --task install, owner, reset-password, seed, doctor or jobs.",
    );
  if (values.mode !== "fixture" && values.mode !== "sandbox")
    throw new Error(
      "Set --mode fixture or --mode sandbox explicitly. Each uses a separate database.",
    );
  process.env.DATABASE_KIND = "d1";
  delete process.env.DATABASE_URL;
  process.env.APP_MODE = values.mode;
  const config = getServerConfig();
  connection = await openD1Maintenance(
    values.local
      ? {
          mode: "local",
          databaseId: values["database-id"] ?? "",
          persistTo: values["persist-to"] ?? "",
        }
      : {
          mode: "remote",
          databaseId: values["database-id"] ?? "",
          accountId: values["account-id"] ?? "",
        },
  );
  const db = createD1Db(connection.binding);
  await withD1Database(db, async () => {
    if (values.task === "install") {
      // INSERT SELECT refuses to stamp an occupied unmarked database as a new installation.
      await connection!.binding
        .prepare(
          "insert into installation(environment) select ? where not exists(select 1 from seller) and not exists(select 1 from user) on conflict(singleton) do nothing",
        )
        .bind(config.mode)
        .run();
    }
    const [marker] = await db.select().from(installation);
    if (marker?.environment !== config.mode)
      throw new Error(
        "Database mode does not match. Run install on a fresh migrated target, or select the correct mode. No records were reset.",
      );
    if (values.task === "install") {
      console.log(
        `D1 installation pinned to ${config.mode}. Existing records were preserved.`,
      );
      return;
    }
    if (values.task === "owner" || values.task === "reset-password") {
      const email = values.email ?? (await ask("Owner email")),
        password = values["password-stdin"]
          ? await readStdin()
          : await askHidden("Owner password (12+ characters)");
      if (values.task === "reset-password") {
        console.log(
          (await resetOwnerPassword(email, password)) === "reset"
            ? "Password changed; owner sessions revoked."
            : "That email is not this installation's owner. Nothing changed.",
        );
        return;
      }
      const result = await bootstrapOwner({
        email,
        password,
        displayName: values.name ?? (await ask("Shop name")),
        country: (values.country ?? "CA").toUpperCase(),
        currency: (values.currency ?? "USD").toUpperCase(),
      });
      console.log(
        result.outcome === "created"
          ? `Owner created. Sign in at ${config.appUrl}/owner/login`
          : `Owner already exists (${result.ownerEmail}). Nothing changed.`,
      );
      return;
    }
    if (values.task === "seed") {
      if (config.mode !== "fixture")
        throw new Error("D1 demo seeding is restricted to fixture mode.");
      if (!Object.hasOwn(PRESETS, values.preset!))
        throw new Error(`Choose a preset: ${Object.keys(PRESETS).join(", ")}.`);
      const result = await seedShop({
        preset: values.preset as PresetKey,
        origins: [],
      });
      // A generated demo password is written to the terminal only on explicit fixture seeding, as in the existing demo CLI.
      console.log(
        result.outcome === "seeded"
          ? `Fictional demo shop seeded (${result.offers} offers). Owner: owner@example.test. Demo password: ${result.fixturePassword ?? "unchanged"}`
          : "Shop already has offers. Nothing reset.",
      );
      return;
    }
    if (values.task === "doctor") {
      const [shops, products] = await db.batch([
        db.select({ name: seller.displayName }).from(seller),
        db
          .select({ id: offer.id })
          .from(offer)
          .where(eq(offer.published, true)),
      ]);
      console.log(
        `D1 reachable. Mode: ${marker.environment}. Shop: ${shops[0]?.name ?? "not created"}. Published offers: ${products.length}. AI and PayPal are not verified by this storage check.`,
      );
      return;
    }
    console.log(JSON.stringify(await runDueWork("cli")));
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "D1 maintenance failed.",
  );
  process.exitCode = 1;
} finally {
  await connection?.close();
}
