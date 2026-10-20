/**
 * Exact-origin parsing shared by configuration, widget framing and request checks.
 *
 * Accepts only scheme://host[:port]. Rejects wildcards, credentials, paths,
 * queries, fragments and plain http outside localhost, so a value can be
 * placed into a frame-ancestors header without further escaping.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function parseExactOrigin(input: string): string | null {
  const value = input.trim();
  if (value.length === 0 || value.length > 255 || /[\s*;,'"]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" || /^[a-z]+:\/\/[^/]+\/./i.test(value)) return null;
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol === "http:" && !isLocal) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isLocal && !HOST_PATTERN.test(url.hostname)) return null;
  return url.origin;
}

/** Normalizes a list of origins; returns the valid ones and the rejected inputs. */
export function parseOriginList(inputs: readonly string[]): { valid: string[]; rejected: string[] } {
  const valid = new Set<string>();
  const rejected: string[] = [];
  for (const input of inputs) {
    const parsed = parseExactOrigin(input);
    if (parsed) valid.add(parsed);
    else if (input.trim() !== "") rejected.push(input);
  }
  return { valid: [...valid], rejected };
}
