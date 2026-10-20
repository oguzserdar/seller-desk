/**
 * Errors every operation may raise. `message` is safe to show to the caller:
 * it never names another buyer's record, a secret, or an internal reason.
 */
export type DomainErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid"
  | "conflict"
  | "sold_out"
  | "expired"
  | "rate_limited"
  | "unavailable";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly next: readonly string[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Used for missing records AND records outside the caller's scope, so the two are indistinguishable. */
export function notFound(what = "record"): DomainError {
  return new DomainError("not_found", `That ${what} was not found.`);
}

export function invalid(message: string): DomainError {
  return new DomainError("invalid", message);
}

export function conflict(message: string, next: readonly string[] = ["reload"]): DomainError {
  return new DomainError("conflict", message, next);
}

export const HTTP_STATUS: Record<DomainErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  sold_out: 409,
  expired: 409,
  rate_limited: 429,
  unavailable: 503,
};
