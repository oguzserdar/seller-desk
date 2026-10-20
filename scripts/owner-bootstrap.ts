/**
 * Creates the installation's owner, or resets that owner's password.
 *
 *   pnpm owner:bootstrap                    interactive
 *   pnpm owner:bootstrap --reset-password   new password for the existing owner, signs out all sessions
 *   echo "$PASSWORD" | pnpm owner:bootstrap --email you@shop.com --name "Your Shop" --password-stdin
 *
 * The password never comes from command-line arguments and is never printed.
 */
import { parseArgs } from "node:util";
import { closeDb } from "../src/server/db/client";
import { bootstrapOwner, resetOwnerPassword } from "../src/server/auth/bootstrap";
import { loadLocalEnv } from "./lib/load-env";
import { ask, askHidden, readStdin } from "./lib/prompt";

loadLocalEnv();
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    country: { type: "string" },
    "password-stdin": { type: "boolean", default: false },
    "reset-password": { type: "boolean", default: false },
  },
});

async function readPassword(): Promise<string> {
  if (values["password-stdin"]) return readStdin();
  const first = await askHidden("Owner password (12+ characters)");
  const second = await askHidden("Repeat the password");
  if (first !== second) throw new Error("The passwords did not match.");
  return first;
}

try {
  const email = values.email ?? (await ask("Owner email"));
  if (values["reset-password"]) {
    const outcome = await resetOwnerPassword(email, await readPassword());
    console.log(outcome === "reset" ? "Password changed. Every owner session was signed out." : "That email is not this shop's owner. Nothing changed.");
    process.exitCode = outcome === "reset" ? 0 : 1;
  } else {
    const name = values.name ?? (await ask("Shop name"));
    const country = (values.country ?? (await ask("Country code", "CA"))).toUpperCase();
    const result = await bootstrapOwner({ email, password: await readPassword(), displayName: name, country, currency: "USD" });
    if (result.outcome === "exists") {
      console.error(`This installation already has an owner (${result.ownerEmail}). Nothing changed.`);
      console.error("Use --reset-password for that owner, or point DATABASE_URL at a fresh database.");
      process.exitCode = 1;
    } else {
      console.log(`Owner created. Sign in at ${process.env.APP_URL ?? "your APP_URL"}/owner/login`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
