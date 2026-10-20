import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A URL-safe random secret. 32 bytes = 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** JSON with sorted object keys, so equal payloads always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return inner;
  });
}

export function hashPayload(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Constant-time comparison of two secrets of any length. */
export function secretsMatch(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && received.length === expected.length;
}
