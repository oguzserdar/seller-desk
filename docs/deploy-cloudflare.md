# Cloudflare Workers

The current isolated hosted sandbox and its actual checks are recorded in
[the 15 October deployment record](deployment-cloudflare-2026-10-15.md).

The same source builds for Next.js/Node and Cloudflare Workers. Workers can use native D1 or PostgreSQL. The [database guide](database-portability.md) explains the two schemas and shared behavioral tests.

The pinned Workers path uses vinext 1.1.0, @vinext/cloudflare 1.1.0, Vite 8.3.0, @cloudflare/vite-plugin 2.0.0-beta.sha-91c870c02 and cf 1.0.0-beta.14. Cloudflare documents [vinext for Next.js](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/); it remains beta. Exact dependency versions are pinned in the lockfile.

## Deploy Button installation

The README's **Deploy to Cloudflare** button uses Cloudflare's documented Git-based installation flow. It needs public source and your Cloudflare account. It creates a dedicated D1 database and a SQLite Durable Object namespace for fictional seller tests. It does not select the existing hosted demo or another application's database.

1. Choose your new Worker name and resources in the import form. Supply three different random secrets of at least 32 characters: `BETTER_AUTH_SECRET`, `JOBS_SECRET` and `INSTALL_TOKEN`. The template reads these names from `.dev.vars.example`; no credentials are shipped.
2. Use `pnpm build` for the build field and `pnpm run deploy` for the deploy field. The `run` matters: `pnpm deploy` is a different pnpm command. Workers CI runs the Cloudflare installation build. Its Wrangler configuration receives the newly provisioned database ID. The deploy script applies D1 migrations by the `DB` binding name, pins sandbox mode, then deploys the Worker and scheduled recovery handler. It records the exact address from Wrangler’s structured deployment result and creates APP_URL only when that secret is absent. It stops on an error.
3. Open the new address printed at the end of deployment or shown under Workers & Pages → your Worker → Visit. No account subdomain or origin needs to be guessed. An empty shop opens `/owner/start`. Enter `INSTALL_TOKEN` and create your owner account. The token is sent only in a POST body. An existing owner closes this setup path automatically.
4. Sign in and remove `INSTALL_TOKEN` from Worker settings. Connect your actual AI provider and PayPal sandbox app using encrypted server secrets. No successful AI or payment is simulated in sandbox mode when a key is missing.

This installer uses `wrangler.jsonc`. The existing demo's explicit account/database deployment keeps using `cloudflare.config.ts` and `pnpm deploy:cloudflare`; the installation template does not replace that destination. Do not run `pnpm run deploy` against an unrelated project. Source/builds exclude private settings and existing database IDs. The template keeps dashboard variables across redeploys. An existing APP_URL secret, including an approved custom domain, is preserved. To change the canonical address later, update that encrypted secret under Settings → Variables and Secrets and deploy the configuration change.

The current fresh-install evidence and remaining hosted checks are listed in [readiness](readiness.md). A badge does not prove account authorization, successful provisioning or a live model.

## Local D1 installation

```sh
pnpm install --frozen-lockfile
pnpm demo:d1
```

This creates a separate fictional shop, keeps D1 data in `.seller-desk/d1` and writes only private local settings. The command prints where to find the local owner login. The command builds and opens a production preview; no development compiler stays running. No cloud account is needed. Existing PostgreSQL settings and data are preserved. Stop with Ctrl+C; rerun to keep using the same shop.

For a production bundle check:

```sh
pnpm demo:d1 --setup-only
pnpm build:cloudflare --mode d1
pnpm preview:cloudflare --mode d1
```

The default address is localhost:4310. If you chose another port when creating the demo, pass the same `--port` to preview. Do not run builds and app servers concurrently in one checkout: Next.js and vinext share generated `.next/types` files. `pnpm check` restores the canonical Next.js route types.

## D1 settings on the real host

Create a separate D1 database for Seller Desk. Do not reuse another application's database. In private `.dev.vars` or mode-specific `.dev.vars.<mode>`, set:

```dotenv
APP_MODE=sandbox
APP_URL=https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
DATABASE_KIND=d1
D1_DATABASE_ID=YOUR_EXISTING_DATABASE_UUID
BETTER_AUTH_SECRET=GENERATE_A_UNIQUE_VALUE_OF_AT_LEAST_32_CHARACTERS
JOBS_SECRET=GENERATE_A_DIFFERENT_UNIQUE_VALUE_OF_AT_LEAST_32_CHARACTERS
AI_PROVIDER=anthropic
AI_MODEL_ID=claude-sonnet-5-5
AI_ROUTING_PROVIDER=off
ANTHROPIC_API_KEY=
```

Leave `DATABASE_URL` absent. D1 refuses an ambiguous configuration containing both backends. `D1_DATABASE_ID` selects the existing native `DB` binding at build time. Local binding emulation is explicit; development does not connect to the remote database by accident.

Add your PayPal sandbox app's client ID, client secret, merchant ID and webhook ID as described in [the guide](guide.md). Configure the selected AI provider separately; a missing key leaves the assistant visibly unavailable. Optional Haiku classification, Jev and OpenAI Decisions never authorize payments or seller actions.

Apply migrations to the exact account and database:

```sh
pnpm db:migrate:d1 --remote --account-id ACCOUNT_ID --database-id DATABASE_UUID
pnpm d1:admin --remote --account-id ACCOUNT_ID --database-id DATABASE_UUID --mode sandbox --task install
pnpm d1:admin --remote --account-id ACCOUNT_ID --database-id DATABASE_UUID --mode sandbox --task owner --email YOU@YOUR_SHOP --name "Your shop"
```

The owner command prompts privately for a password. It does not expose public signup. Use `--task reset-password` for that owner's reset, which revokes existing sessions. Use `--task doctor` to inspect the destination without printing credentials. No maintenance command resets a populated shop or changes another project's login/configuration.

Keep auth, job, AI and PayPal values as encrypted Worker secrets. `cloudflare.config.ts` emits secret names, never their values. It declares only the selected integration keys and necessary settings. Changing providers requires a corresponding rebuild and remote secret update. Do not publish `.dev.vars*`, `.env*`, local D1 state, owner credentials or Cloudflare tokens. The source archive excludes them.

`pnpm deploy:cloudflare` performs an external deployment. Run it intentionally against your own account after configuring the exact destination and encrypted secrets. No deploy badge claims an unattended installation or verified hosted AI.

## PostgreSQL on Workers

Set `DATABASE_KIND=postgres` and provide a reachable `DATABASE_URL`; omit the D1 settings. Each invocation gets its own lazy pool, capped at five connections, and owns its auth, payment and frame-policy objects through streaming. Node hosts retain their ordinary bounded process pool. Network work is outside database transactions. Hyperdrive is not configured or verified.

## Recovery and isolation

The scheduled handler runs each minute. The shared recovery engine uses a cooperative deadline and preserves unfinished work. D1 admits one queued item per invocation and rotates queue priority, keeping individual recovery work bounded. A finished pass does not prove the backlog is empty.

Seller-facing tests now allocate a fresh SQLite Durable Object per side through the private `SIMULATIONS` binding. They never run fictional commerce against or reset the live D1/PostgreSQL shop. The original database keeps the durable report; temporary trial storage is discarded, with an expiry alarm for abandoned trials. Snapshot copying excludes credentials, customer histories, private seller exceptions and purchased file bytes. A trial uses an explicit fictional download. Real model-driven trials require a provider key; storage contracts are not successful AI simulations. Earlier operator-selected fixture databases remain preserved for their independent acceptance tests; they are not reused by the seller UI.

## Verified scope and limits

The local production Worker bundle has completed goods, digital and seller-reviewed service purchases against native D1, with actual owner sign-in, quote approval, published knowledge/version history, desktop/mobile rendering and reload recovery. Independent D1 reads checked the paid orders, captures, download count, tasks and foreign keys. PayPal was explicitly simulated and AI disconnected during this browser run. The PostgreSQL production app was checked separately without resetting earlier records.

The actual Wrangler migration test upgrades a populated application, compares records and private file bytes, restarts the native binding and reruns migrations. The shared storage suite covers both backends. Hosted model behavior, hosted PayPal sandbox callbacks, scheduler delivery, CPU limits and independent HTTPS widget framing require their own evidence.

Cloudflare's [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) include 100 bound parameters per statement and 50 queries per invocation on Free. Native bulk operations and ten-item cart tests cover those constraints. The [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) separately constrain CPU; local success does not establish that the whole app fits Free. The source is free to install. Hosting and model usage can cost money. Digital files remain capped at 1 MiB; R2 is not implemented.
