# Install on Vercel

Use the **Deploy with Vercel** button in the README. It clones the public source into your account and uses the pinned Next.js/Node build. This path uses PostgreSQL; the separate Cloudflare button uses native D1.

## Before you click

The button offers a new Neon PostgreSQL database through Vercel’s native Marketplace integration. It supplies DATABASE_URL to the project. Choose its plan in your own account; a paid purchase is not required by this source. For a manual import, set `ENABLE_EXPERIMENTAL_COREPACK=1` before the first build and use automatic dependency installation; do not override it with plain `pnpm install`, which can select an older pnpm on Vercel. You can supply a dedicated PostgreSQL database with TLS. Never select another app’s database or expose a local database. Keep state queries uncached.

Prepare three **different** random values of at least 32 characters: `BETTER_AUTH_SECRET`, `JOBS_SECRET` and `INSTALL_TOKEN`. Generate each separately with a password manager or `openssl rand -hex 32`. Do not use demo credentials.

## Installation flow

1. Create the separate database in the integration step. The button asks for those three private values. Keep the nonsecret defaults `APP_MODE=sandbox`, `DATABASE_KIND=postgres` and `ENABLE_EXPERIMENTAL_COREPACK=1`. Corepack makes Vercel use the exact pnpm version declared in package.json. Native AI and PayPal keys are not required to create the owner account.
2. The installation build validates settings, applies the committed PostgreSQL migrations on production deployments, pins the database mode, then builds Next.js. Preview builds and runtime are disabled to prevent inherited production credentials reaching the live shop. Use a separate Seller Desk project with its own database for test deployments. Neon’s DATABASE_URL_UNPOOLED is used for migrations when provided. A migration failure stops the build. Rebuilding preserves existing records and the owner; it does not reseed a demo or reset a password.
3. Open the deployed address. An empty shop opens `/owner/start`. Enter your private `INSTALL_TOKEN`, shop details and a new owner password. The form verifies the origin and token and uses the same atomic bootstrap as the operator CLI. An occupied installation refuses this route, including concurrent setup attempts.
4. Sign in. Remove `INSTALL_TOKEN` from Vercel's environment settings after owner creation. Redeploy to apply that environment change. The account remains usable; public signup stays disabled.
5. Connect your actual AI provider and PayPal sandbox app in the server environment. The assistant remains visibly disconnected until a real provider is configured. PayPal credentials are never part of the browser widget.

Vercel's assigned `*.vercel.app` hostname supplies the origin when `APP_URL` is unset. Production uses `VERCEL_PROJECT_PRODUCTION_URL`, falling back to `VERCEL_URL`. Preview deployments are refused before database work. The app never derives this value from an HTTP header. When attaching a custom domain, set `APP_URL` to that exact HTTPS origin and redeploy. Use that origin for the PayPal return URLs and `/api/paypal/webhook`.

The button needs public source. The current publication/fresh-install evidence is recorded in [readiness](readiness.md); a passing build is not proof of a fully configured hosted shop.

## Existing installations and manual hosting

Manual `pnpm db:migrate` and `pnpm owner:bootstrap` remain available from a trusted environment. The browser installer never changes an existing password. To rotate one intentionally, use the documented operator command. Native Next.js builds still use `pnpm build`; Vercel uses `pnpm build:vercel` from `vercel.json`.

The real seller-test runner uses fresh in-memory SQLite per trial side on Node, preserves its reports in your PostgreSQL database, and never opens the actual store database for fictional commerce. See [seller tests](seller-tests.md).

## Scheduling is an unfinished platform gate

Local `pnpm demo` runs the recovery worker every 30 seconds. Hosted jobs cannot rely on the Next.js `after` callback or an in-memory timer. Each recovery pass now has a 45-second cooperative budget and count limits. Queues take turns, no new item starts after cancellation, and PayPal requests and AI continuations receive the shared abort signal. The route declares a 120-second platform ceiling. Already-running database queries and durable cleanup are awaited, so 45 seconds is not a proven hard upper bound for the whole request. The response reports work counts, elapsed time and whether the pass finished its batch, hit its budget or was cancelled. A finished batch does not imply an empty backlog.

Local tests exercise cancellation before work, interruption during PayPal reads and AI generation, and a simulated capture whose response is lost. A later pass finds that capture with the same payment identity and records one order. These tests do not prove host termination/restart or real PayPal behavior. Verify both before enabling public recovery. Never remove database claims or call an uncertain payment failed.

At the 9 October documentation check, Hobby Cron permits one run a day and may execute within the scheduled hour; Pro and Enterprise permit one run a minute. Once a day is inadequate for prompt payment and seller-answer recovery. Select an appropriate plan or a separately authenticated frequent scheduler and verify it. No paid-plan purchase or reliable free hosted scheduling is implied by this guide. Add a real `vercel.json` schedule only after that decision and verification; no placeholder schedule is shipped as if it were working.

## Required hosted proof

- Owner login and protected routes on the final HTTPS origin.
- Real model tool calls and streaming, including failure and cancellation.
- Approved and rejected PayPal sandbox checkout, independent payment verification and webhook recovery.
- Retry after a killed or timed-out function, without duplicate charges/orders.
- Widget allowed and denied origins, full-page checkout handoff, and digital download access.
- Fresh install by someone with no local settings or database.

Primary references checked 9 October 2026: [Vercel Cron getting started](https://vercel.com/docs/cron-jobs/quickstart), [securing and managing Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Cron frequency limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [function duration](https://vercel.com/docs/functions/configuring-functions/duration), and the pinned Next.js 16.3.8 `after` and `maxDuration` documentation shipped with the dependency.

Package-manager evidence: [Vercel package-manager selection](https://vercel.com/docs/package-managers) and [Corepack opt-in](https://vercel.com/docs/builds/configure-a-build#corepack). The declared pnpm 10.2.1 completes the frozen install; the older global pnpm 9 reproduced a patch-hash mismatch.
