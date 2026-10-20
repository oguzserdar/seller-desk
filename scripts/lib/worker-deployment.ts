/** Validates the structured deployment record emitted by the pinned Wrangler CLI. */
import { parseExactOrigin } from "../../src/lib/origin";

/** Reads the actual assigned Workers address, never guesses an account subdomain or Worker name. */
export function deployedWorkerAddress(ndjson: string): { name: string; origin: string } {
  const entries = ndjson.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  const deployment = entries.findLast(entry => entry.type === "deploy" && entry.version === 1);
  if (!deployment || typeof deployment.worker_name !== "string" || !/^[a-z0-9_-]{1,63}$/i.test(deployment.worker_name) || !Array.isArray(deployment.targets)) throw new Error("Wrangler did not record a valid deployment identity.");
  const targets = deployment.targets.filter((value): value is string => typeof value === "string").map(value => parseExactOrigin(value)).filter((value): value is string => Boolean(value && new URL(value).protocol === "https:" && new URL(value).hostname.endsWith(".workers.dev")));
  const unique = [...new Set(targets)];
  if (unique.length !== 1) throw new Error("Wrangler did not record one exact Workers address. No origin was changed.");
  return { name: deployment.worker_name, origin: unique[0]! };
}
