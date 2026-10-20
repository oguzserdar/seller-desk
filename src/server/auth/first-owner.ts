/** Protected, one-time browser installation. This never resets an existing owner's credentials. */
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { getSeller } from "@/server/domain/seller";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { DomainError } from "@/server/domain/errors";
import { getServerConfig } from "@/server/env";
import { bootstrapOwner } from "./bootstrap";

/** Installation token travels in a POST body, never a query string or saved shop record. */
export const FirstOwnerInput = z.object({
  token: z.string().min(32).max(256), email: z.email().max(200), password: z.string().min(12).max(128),
  displayName: z.string().trim().min(1).max(80), country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().refine(value => SUPPORTED_CURRENCIES.includes(value)),
}).strict();

/** Disabled by default; the host operator must set a distinct random private installation token. */
export function firstOwnerSetupEnabled(): boolean {
  const token = process.env.INSTALL_TOKEN;
  if (!token || token.length < 32 || token.length > 256) return false;
  const config = getServerConfig();
  return token !== config.authSecret && token !== config.jobsSecret;
}

/** Authorizes against a host secret, enforces origin/rate limits, then uses the atomic empty-shop bootstrap. */
export async function installFirstOwner(raw: z.infer<typeof FirstOwnerInput>, requestHeaders: Headers): Promise<{ created: boolean }> {
  const input = FirstOwnerInput.parse(raw);
  const config = getServerConfig();
  if (!firstOwnerSetupEnabled() || await getSeller()) throw new DomainError("unavailable", "Owner setup is closed. Sign in to your desk.");
  if (requestHeaders.get("origin") !== config.appUrl) throw new DomainError("unauthorized", "Open setup on your shop's own address.");
  const client = createHash("sha256").update(clientKey(requestHeaders)).digest("hex");
  await requireUsage("first_owner_setup", client, 3600, 10, "Too many setup attempts.");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(input.token), digest(process.env.INSTALL_TOKEN!))) throw new DomainError("unauthorized", "The installation token did not match.");
  const result = await bootstrapOwner(input);
  if (result.outcome !== "created") throw new DomainError("unavailable", "Owner setup is closed. Sign in to your desk.");
  return { created: true };
}
