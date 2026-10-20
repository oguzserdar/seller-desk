/**
 * Which sites may frame the buyer surface. Origins come from the owner's
 * settings, are validated as exact origins on save and again here, and are
 * cached briefly (as a promise, so concurrent requests share one query).
 * Any failure falls back to "only this app", never to "anyone".
 */
import { parseOriginList } from "@/lib/origin";
import { getSeller } from "@/server/domain/seller";
import { getRequestScope } from "@/server/request-scope";

const TTL_MS = 15_000;
let cache: { promise: Promise<string[]>; expiresAt: number } | null = null;

/** Only buyer-facing surfaces may be embedded by an approved site. */
export const FRAMEABLE_PATHS = new Set(["/widget", "/buy"]);

/** Reads approved sites without sharing pending I/O between Worker invocations. */
export function allowedFrameOrigins(): Promise<string[]> {
  const scope = getRequestScope();
  const now = Date.now();
  if (scope?.frameOrigins) return scope.frameOrigins;
  if (!scope && cache && cache.expiresAt > now) return cache.promise;
  const promise = getSeller()
    .then((row) => parseOriginList(row?.allowedOrigins ?? []).valid)
    .catch((error: unknown) => {
      console.error("frame policy: could not read allowed origins", error);
      return [];
    });
  if (scope) scope.frameOrigins = promise;
  else cache = { promise, expiresAt: now + TTL_MS };
  return promise;
}

/** Called after the owner saves origins so the change applies immediately. */
export function forgetFrameOrigins(): void {
  const scope = getRequestScope();
  if (scope) scope.frameOrigins = undefined;
  cache = null;
}

/** Builds the frame-ancestors directive from the validated owner settings. */
export function frameAncestors(path: string, origins: readonly string[]): string {
  if (!FRAMEABLE_PATHS.has(path)) return "'none'";
  return ["'self'", ...origins].join(" ");
}
