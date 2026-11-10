/**
 * Drizzle wraps a database error as "Failed query: ..." and keeps the database's own words in
 * `cause`. Better Auth's plugins read only `message` to recognise a duplicate row or a missing
 * table, for example when two first requests on a new installation both create the connector's
 * resource row. Without the database's words that harmless race fails the request.
 */
import type { BetterAuthOptions } from "better-auth";

type AdapterFactory = Extract<NonNullable<BetterAuthOptions["database"]>, (...args: never[]) => unknown>;

const WRITES_AND_READS = new Set(["create", "findOne", "findMany", "update", "updateMany", "delete", "deleteMany", "count"]);

function withDatabaseWords(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const parts: string[] = [];
  for (let cause: unknown = error.cause; cause instanceof Error; cause = cause.cause) parts.push(cause.message);
  if (parts.length > 0 && !parts.every((part) => error.message.includes(part))) error.message = `${error.message} (${parts.join("; ")})`;
  return error;
}

/**
 * Makes a Better Auth database adapter report the database's own error text.
 *
 * @param factory - The adapter factory from `drizzleAdapter`
 * @returns The same adapter, whose failed calls carry the cause's message
 */
export function reportingDatabaseErrors(factory: AdapterFactory): AdapterFactory {
  return ((options: Parameters<AdapterFactory>[0]) => {
    const adapter = factory(options) as unknown as Record<string, unknown>;
    return new Proxy(adapter, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof property !== "string" || !WRITES_AND_READS.has(property) || typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          try {
            return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          } catch (error) {
            throw withDatabaseWords(error);
          }
        };
      },
    });
  }) as unknown as AdapterFactory;
}
