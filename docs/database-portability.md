# PostgreSQL and Cloudflare D1

Seller Desk supports two installation backends:

- **PostgreSQL** for the normal Next.js/Node or Vercel installation. It also works from Workers using an invocation-owned PostgreSQL connection.
- **Cloudflare D1** for Workers, with the native `DB` binding. The local demo runs the same D1 API in workerd.

Choose one backend for an installation. The app never dual-writes or falls back from D1 to PostgreSQL. Changing a setting does not copy an existing shop. Use a separate database for fictional demos and PayPal sandbox records.

## Run a local D1 shop

```sh
pnpm install --frozen-lockfile
pnpm demo:d1
```

The command creates private `.dev.vars.d1` settings and a persistent fictional database under `.seller-desk/d1`. It migrates the database, creates a demo owner and seeds the shop only when empty. The generated owner login is in `.seller-desk/d1-demo-owner.private.json`. It builds the app and starts one Workers production-preview server and triggers authenticated recovery once a minute. Stop it with Ctrl+C; the next run keeps the same records and login.

Use `pnpm demo:d1 --setup-only` for setup without a server. `--port 4461` can select a port on the first run. Existing settings are never overwritten. AI requires a real provider key; the demo does not synthesize successful answers. PayPal is explicitly simulated in fixture mode.

## What is shared

Prices, quote validation, payment orchestration, provider-evidence checks, access terms and seller-facing descriptions use shared application logic. Both backends are tested through the same public operations, including:

- Goods, reviewed services and private digital purchases.
- Concurrent checkout, payment executor replacement and replay after lost responses.
- Verified payment followed by fulfillment, with atomic stock, audit and job outcomes.
- Buyer capability revocation, seller takeover, interrupted input and ordered history recovery.
- Owner approval, private answer review, explicit knowledge publication, versioned instructions and private simulation receipts.
- Exact paid totals by currency and seller calendar day, including repeated midnight.
- First installation, password reset and session revocation through real Better Auth.

Storage tests execute real PostgreSQL and Miniflare/workerd D1 queries. They do not establish live AI quality or real PayPal webhook delivery. Explicit simulator faults are payment tests, never fake model responses.

## What is native

`src/server/db/schema.ts` is the PostgreSQL schema. `src/server/db/sqlite/schema.ts` is the D1 schema. Their 52 logical table row types, columns, business constraints and relationships are checked for parity. D1 additionally owns native identity counters and an installation identity used to prevent simulation against the source database.

PostgreSQL commands use transactions and row locks. D1 commands use atomic native batches, conditional writes, unique constraints and fresh execution guards. Network calls to PayPal or a model happen outside database transactions. An old receipt can return an existing result; it cannot authorize repeating stock or fulfillment effects.

D1 uses integer timestamps in milliseconds, constrained booleans and JSON text, native BLOBs for private files and canonical UUIDs. Large reviewed imports, message histories, catalog membership and stock changes use native bulk queries to stay below binding limits. Message/order numbers come from durable counters, never process memory or row counts.

Both auth schemas come from the installed Better Auth version. Passwords use Better Auth's configured hasher. Public signup remains disabled. Owner creation is an operator command, with credentials and the shop committed together.

## Migrations

There are two independent SQL histories:

| Backend | Schema | Migration history | Applied ledger |
| --- | --- | --- | --- |
| PostgreSQL | `src/server/db/schema.ts` | `drizzle/` | Drizzle's PostgreSQL ledger |
| D1 | `src/server/db/sqlite/schema.ts` | `drizzle-d1/` | Wrangler's `d1_migrations` |

Never translate PostgreSQL SQL at runtime or apply it to D1. Never edit an applied migration. A logical schema change needs the corresponding native schema, a new migration for each affected backend and shared behavioral tests.

```sh
pnpm db:generate
pnpm db:generate:d1
pnpm db:check:d1
```

D1 migration execution requires an explicit local or remote destination. The runner checks every SQL file before staging the exact bytes for Wrangler. It rejects table rebuilds, pragmas, drops and data rewrites. This is deliberate: ordinary SQLite parent-table rebuilds can silently delete related rows under D1's foreign-key behavior. A non-additive change needs a migration-specific preservation strategy and a populated-upgrade test; there is no unchecked bypass.

The application upgrade test applies the actual baseline with Wrangler, creates a real fictional shop and payment through the native binding, upgrades the populated database, compares stored records and BLOBs, restarts it, checks the order and reruns migrations. The separate runner test checks failure rollback and resumption. PostgreSQL migration history remains unchanged by the D1 port.

## Explicit D1 maintenance

For example, use the same UUID and state directory for both commands:

```sh
pnpm db:migrate:d1 --local --database-id DATABASE_UUID --persist-to .seller-desk/d1
pnpm d1:admin --local --database-id DATABASE_UUID --persist-to .seller-desk/d1 --mode fixture --task install
```

`d1:admin` also supports `owner`, `reset-password`, `seed`, `doctor` and `jobs`. For `owner`, provide `--email` and `--name`; it prompts privately for the password. `--password-stdin` reads it from stdin, never command-line arguments. `seed` is restricted to fixture mode. An occupied installation is preserved.

Remote commands replace `--local`/`--persist-to` with `--remote --account-id ACCOUNT_ID`. They require the operator's existing Cloudflare authorization and an exact database UUID. Maintenance uses Wrangler's official native-binding proxy in an isolated temporary configuration. It does not modify another project's configuration or global login.

## Boundaries

D1 recovery handles one queued work item per invocation and rotates queue priority. It does not claim an empty backlog after one pass. Live AI conversations and hosted CPU limits still need testing with the selected model and host. Private digital uploads remain capped at 1 MiB on both backends; R2 is not required or implemented. No automatic PostgreSQL-to-D1 data converter is included.
