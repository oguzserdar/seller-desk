/** A private, persistent PostgreSQL cluster for the local demo, bound to loopback only. */
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

/** Reserves an available loopback port long enough to choose a local database address. */
export async function availablePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return server.close(() => reject(new Error("Could not select a local port.")));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

/**
 * Starts this checkout's database. Both explicit and signal-triggered shutdown
 * wait for dependent processes before closing PostgreSQL, exactly once.
 * @param connectionString The original managed loopback database address.
 * @param beforeStop Closes this installation's dependent processes/connections.
 * @returns The same idempotent stop operation used by the dependency's exit hook.
 */
export async function startLocalDatabase(connectionString: string, beforeStop: () => Promise<void>): Promise<() => Promise<void>> {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/seller_desk_demo" || url.username !== "seller_desk" || !url.password || !url.port) {
    throw new Error("The managed demo database needs its original local address. Use a separate checkout for an external database.");
  }
  if (process.getuid?.() === 0) throw new Error("Run the local demo as a regular user. It does not create system accounts.");
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  class ManagedDatabase extends EmbeddedPostgres {
    private stopping: Promise<void> | undefined;

    // The package's exit hook calls this public method too. A wrapper only on
    // the returned callback would let that hook stop PostgreSQL prematurely.
    override stop(): Promise<void> {
      return this.stopping ??= (async () => {
        try { await beforeStop(); }
        finally { await super.stop(); }
      })();
    }
  }
  const databaseDir = path.resolve(".seller-desk", "postgres");
  mkdirSync(path.dirname(databaseDir), { recursive: true, mode: 0o700 });
  const database = new ManagedDatabase({
    databaseDir, port: Number(url.port), user: url.username, password: decodeURIComponent(url.password),
    authMethod: "scram-sha-256", persistent: true, createPostgresUser: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1", "-c", "max_connections=30", "-c", "shared_buffers=32MB", "-c", "unix_socket_directories="],
    onLog: () => {}, onError: () => {},
  });
  const oldMask = process.umask(0o077);
  try {
    if (!existsSync(path.join(databaseDir, "PG_VERSION"))) await database.initialise();
  } finally { process.umask(oldMask); }
  await database.start();
  const stop = () => database.stop();
  const client = database.getPgClient("postgres", "127.0.0.1");
  try {
    await client.connect();
    const exists = await client.query("select 1 from pg_database where datname = $1", ["seller_desk_demo"]);
    if (exists.rowCount === 0) await client.query('create database "seller_desk_demo"');
  } catch (error) {
    await client.end().catch(() => {});
    await stop();
    throw error;
  }
  await client.end();
  return stop;
}
