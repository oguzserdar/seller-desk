# What works and what remains

Current as of October 19, 2026 (America/Edmonton). The implementation candidate is newer than the hosted October 15 app. Local installation checks and the existing hosted demo are separate evidence.

## Existing hosted demo

[Demo](https://seller-desk.oguz-077.workers.dev/buy). PayPal sandbox only.

The existing Worker remains on version `9481e2a4-44a4-44eb-a568-b98e15caa3f1`. The October 19 browser run completed a $25 USD download purchase through the actual app and PayPal sandbox buyer UI. Independent PayPal and native-D1 reads agree on one completed capture, one paid attempt and one order. Both original webhook events were processed. Reload preserves the paid order.

The browser download was recorded. A separate authorized operator retry returned the exact stored 1,595-byte ZIP and SHA256. An incorrect token was refused. The browser tool masks hidden grant tokens; the initial redacted-token HTTP check correctly received 404 and was not an application failure. The operator byte check is not described as a second customer download.

A real Cloudflare minute-scheduler invocation completed without exceptions and logged the recovery summary. The access job is done and its digital-delivery task is completed. This single pass used 9 ms CPU and 456 ms wall time; it does not establish full-load Free-plan capacity.

Per-row checks across 47 tables retain the original merchant rows. An expected usage counter changed, and the new test purchase added its related quote, payment, order, access, task/job, audit and webhook rows. Existing deployment identity and encrypted-secret names are unchanged. No credential was rotated or app data reset.

PayPal accepted duplicate capture-event resends with HTTP 202, but redelivery was not observed within bounded listening. That check remains unverified. A normal-return purchase does not prove controlled interrupted-return recovery.

## Current implementation candidate

**Knowledge → Test your assistant** is now wired to the actual buyer runtime. Owners can write a fictional request and expected result, add customer follow-ups and seller replies, approve a service scope or exact fictional purchase, and compare published instructions with a saved version. Results preserve actual conversation text, actions and independent database counts. Expected outcomes never reach the model as desired answers.

Each side receives fresh isolated SQLite storage on Node or a SQLite Durable Object on Workers. Original customers, stock, orders, private seller exceptions, credentials and purchased files are excluded. The source shop keeps the durable report. Partial failures remain visible; a finished run is not automatically a pass. A connected real model is required. No successful assistant reply is supplied when a key is missing. See [seller tests](seller-tests.md).

Actual owner forms on a separate local D1 installation saved terms and created/published goods and seller-reviewed service offers. Purchase/scope approvals start unchecked and clear after changes to the expectation, quantity or scope. Missing AI keeps Run disabled and creates no invented successful report. Desktop and 360/390px mobile checks, real owner sign-in, reload and unauthenticated redirects passed with empty final console/page-error lists.

## Installation evidence

| Path | Verified locally | Still needs hosted proof |
| --- | --- | --- |
| Vercel / PostgreSQL | Fresh frozen dependency install with declared pnpm 10.2.1; committed migrations on a new database; Next.js production build; protected first-owner creation, sign-in and browser walkthrough | Public Git clone, Neon provisioning and actual Vercel deployment |
| Cloudflare / D1 | Clean production Worker build and deployment dry run; actual Wrangler local migrations; protected first-owner creation, sign-in, real offer publication and seller-plan browser walkthrough on independent native D1 | Public Git clone, newly provisioned D1/trial namespace, actual installation deploy command and host limits |

Both official buttons are in the README with installation code behind them. Their proposed GitHub source repository is not yet public: publication is awaiting operator approval. Neither badge is claimed as a verified end-to-end installer.

The Vercel button enables Corepack to honor the pinned pnpm version; it does not override installation with plain `pnpm install`, which can select an old pnpm on Vercel. Production builds migrate; preview builds and runtime are refused to protect the production database. The button offers a separate Neon database. Vercel still needs a frequent authenticated recovery scheduler. See [Vercel installation](deploy-vercel.md).

The Cloudflare template selects a new dedicated D1 database and SQLite trial namespace. It runs additive migrations, records the actual assigned Worker origin, preserves dashboard settings and includes the minute handler. It does not select another application's database. See [Cloudflare installation](deploy-cloudflare.md).

## Checks completed

- Earlier full sequential suite: 825 tests across 144 files, before final review fixes.
- Final focused behavior/storage/UI run: 34 tests across six files. Final package-manager installer correction: eight tests across two files. These counts overlap and are not a new whole-suite total.
- Current type, generated trial-schema and source checks passed. The source-query lifecycle and shared 750-request trial-storage ceiling have regression coverage.
- Goods, services and downloads, exact-price refusal, seller scope approval, lost-capture/download recovery and failure/retry persistence passed real storage checks across PostgreSQL, Node SQLite and Worker SQLite paths. Those commerce contracts are not successful AI conversations or hosted lost-return proof.
- Claude Code reviewed the implementation, installer fixes and sanitized hosted evidence in the existing PayPal session. It found no remaining release-blocking code defect in the inspected scope. Review and test counts do not establish operational readiness.
- Current public raster media passes the metadata allowlist; licenses and notices remain. The original README narrative, exploded imagery and learning animation are retained. Existing UI captures use fictional local purchases; the learning animation is an illustration, not a live transcript.

## Required before final submission

1. Approve public source release, then exercise both Git-based deployment buttons against new isolated resources. Account/integration consent and any required human confirmation remain separate from a passing local build.
2. The owner personally configures the deferred native Anthropic key. Run the current buyer/seller, approval-boundary, conversation-recovery, reviewed-learning/privacy and full simulation scenarios with real model output. Sonnet and the optional routers have not received current live acceptance.
3. Verify controlled hosted interrupted-return recovery and actual duplicate webhook redelivery. The normal-return sandbox purchase and original webhooks above are complete; these additional failure cases remain open.
4. Check independent HTTPS website/WordPress installation, full-load hosting behavior and a suitable frequent Vercel scheduler. One idle Cloudflare invocation is insufficient capacity evidence.
5. Record the current end-to-end demonstration, review the public video/project description, then submit with operator confirmation. Nothing has been submitted automatically.

The source is free to install. Hosting, model usage and payment processing have separate costs. Shipping, refunds, subscriptions and booking remain in the seller's existing tools. Digital files remain capped at 1 MiB.

## Earlier evidence

The [PostgreSQL/D1 verification record](database-verification-2026-10-15.md), [October 15 deployment record](deployment-cloudflare-2026-10-15.md), [verification history](proof-matrix.md) and [handover](../HANDOFF.md) preserve the dated scope. Earlier failures or unverified statements there do not replace the current checklist above. No new cloud deployment or public repository has been created by the October 19 implementation work.
