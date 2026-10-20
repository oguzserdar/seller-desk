/**
 * Response envelope for route handlers: every reply carries a request id, a
 * typed state, a safe message, the allowed next actions and minimal data.
 * Unknown errors are logged with the request id and never shown in detail.
 */
import { ZodError } from "zod";
import { ConfigError } from "@/server/env";
import { DomainError, HTTP_STATUS } from "@/server/domain/errors";

export type ApiEnvelope<T> = {
  requestId: string;
  state: "ok" | DomainError["code"] | "error";
  message: string;
  next: readonly string[];
  data: T | null;
};

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(requestId: string, data: T, message = "OK", next: readonly string[] = [], status = 200): Response {
  const body: ApiEnvelope<T> = { requestId, state: "ok", message, next, data };
  return Response.json(body, { status, headers: { ...NO_STORE, "X-Request-Id": requestId } });
}

export function failure(requestId: string, error: unknown): Response {
  if (error instanceof DomainError) {
    const body: ApiEnvelope<null> = { requestId, state: error.code, message: error.message, next: error.next, data: null };
    return Response.json(body, { status: HTTP_STATUS[error.code], headers: { ...NO_STORE, "X-Request-Id": requestId } });
  }
  if (error instanceof ZodError) {
    const body: ApiEnvelope<null> = { requestId, state: "invalid", message: "That request was not valid.", next: [], data: null };
    return Response.json(body, { status: 400, headers: { ...NO_STORE, "X-Request-Id": requestId } });
  }
  if (error instanceof ConfigError) {
    console.error(`[${requestId}] configuration error`, error.problems);
    const body: ApiEnvelope<null> = { requestId, state: "unavailable", message: "This shop is not configured correctly yet.", next: [], data: null };
    return Response.json(body, { status: 503, headers: { ...NO_STORE, "X-Request-Id": requestId } });
  }
  console.error(`[${requestId}] unexpected error`, error);
  const body: ApiEnvelope<null> = { requestId, state: "error", message: "Something went wrong. Try again in a moment.", next: ["retry"], data: null };
  return Response.json(body, { status: 500, headers: { ...NO_STORE, "X-Request-Id": requestId } });
}

/** Wraps a handler with a request id and the error-to-envelope mapping. */
export function route<Ctx>(handler: (request: Request, requestId: string, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      return await handler(request, requestId, ctx);
    } catch (error) {
      return failure(requestId, error);
    }
  };
}

/** Reads a JSON body with a size cap, refusing anything that is not an object. */
export async function readJson(request: Request, maxBytes = 32_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new DomainError("invalid", "That request is too large.");
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new DomainError("invalid", "That request was not valid JSON.");
  }
}

/** The buyer capability travels as `Authorization: Bearer <token>`, never in a URL. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
