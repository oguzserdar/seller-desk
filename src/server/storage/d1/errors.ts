/** Only the deliberately failing CHECK is retryable as an optimistic conflict. No row values are needed. */
export function isBatchGuardFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error.message.includes("CHECK constraint failed: operation_key_state_valid")) return true;
    seen.add(error); error = error.cause;
  }
  return false;
}
