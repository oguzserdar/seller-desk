# Cloudflare deployment, 15 October 2026

## Latest authorized UI deployment, 15 October, evening

The operator explicitly requested deploying the reviewed interface. Worker version `9481e2a4-44a4-44eb-a568-b98e15caa3f1` now serves the current account/sidebar, visible palettes, setup anchors, instruction editor and Conversations layout at https://seller-desk.oguz-077.workers.dev. The release was built in an isolated source copy, deployed only to the existing Seller Desk Worker and its existing native D1 binding, without provisioning, migrations or secret uploads. All encrypted bindings and 41 domain-table hashes match the pre-deployment snapshot. Normal hosted POST owner login, desktop/mobile setup and the instruction-editor route were exercised. This supersedes older statements below that these screens are local only.

The README now separates current screenshots from the older recorded walkthrough, exposes both installation paths and links a publication guide with the exact official Vercel template snippet. No public GitHub repository has been created or pushed. Vercel fresh-install and current native-AI/hosted payment completion remain unverified. Public source publication and hackathon submission still require review. Do not inspect or request the deferred native API key.


Seller Desk is deployed at https://seller-desk.oguz-077.workers.dev.
The owner sign-in is `/owner/login`; buyer entry is `/buy`.

This is a fresh isolated sandbox installation using native D1. It is not the
populated local demo, and it is not ready for a judge to complete an AI-assisted
purchase. The hosted shop now includes six published fictional offers, sample terms, a generated
private download and three published knowledge entries. It has no paid orders.
The dedicated native AI key is still absent. PayPal sandbox credentials are now encrypted on the Worker, and the app/webhook connection check passed. A completed hosted purchase and webhook delivery remain unverified. Existing local
shops, payment records and other Cloudflare applications were preserved.

## Latest status: local review source differs from the hosted candidate

The hosted sandbox currently runs version `28c66cda-922b-474e-9084-ec172c0df54d`.
It uses actual Arc owner controls and the official shadcn Sidebar. The login form
uses POST and holds submission until the client handler is ready. Native Claude
is still disconnected; no model access is inferred from a configured name.

The newer source is local/provisional: official Sidebar-07 account row, actual colour samples in Arc RadioCards, nine sticky setup anchors, the existing Arc RichTextEditor and a useful Conversations EmptyState. Its narrow editor link fix prevents submitting the surrounding instruction form. 118 UI/theme tests across 37 files, type/source validation and an isolated Worker production build passed. Actual production desktop/mobile evidence exists. The promoted runtime source matches that successful build. These changes are not deployed. Source and licence details: [UI inventory](ui-sources.md).

Operator visual acceptance, the vanilla embed launcher, current native AI, hosted purchase/recovery, independent integrations, cron delivery and the historical intermittent installer failure remain open. Further deployment, publication and submission are held for review. No provider key was requested, read or configured during this design task.

## Earlier control and account normalization

Worker version `1396bb5e-2cb1-4d4a-a188-c2f46f333ae4` adds a first-name account
menu, consistent 44-pixel fields, plain helper/error text, stable buttons and
compact offer-type choices. The email appears inside the account menu only.
The digital offer picker shows the chosen filename and disables upload until a
file is selected. No approval or payment rules were relaxed.

The final hosted desktop form had full-width title, description and access-day
fields; price and quantity aligned at the same height and position. The phone
form stacked cleanly at 390 pixels. All six owner sections were checked at
1440 and 360 pixels with no document overflow. A real ZIP upload succeeded;
an independent D1 read matched its filename, byte length and SHA-256. The file
was not published as an offer. Account-menu Escape restored focus; actual
sign-out displayed the normal login with no developer commands. Final browser
console and page-error logs were empty. This is evidence for operator visual
review, not a claim that every interaction is verified.

PayPal accepted the existing sandbox app credentials. A separate webhook was
registered for this host, read back and checked for the required events; existing
webhooks were preserved. The hosted owner's connection check passed. Credentials
are encrypted Worker bindings, excluded from source. This does not prove a
payment, capture, webhook delivery or recovery of a real hosted checkout.

Validation for this pass: 109 tests across 33 focused UI/connection files passed;
after the final width/copy adjustment, nine tests across five files passed.
Type/source checks and the final Worker production build passed. No new whole
suite or Next.js production build was run for these control changes. The earlier
whole-suite failure below remains disclosed. No local server remains running.

## Earlier UX deployment

Worker version `5e614a78-d615-47c7-b7fc-6ce64893f868` includes the production
login cleanup, compact order views, aligned menu counts and keyboard focus,
theme-scoped menus, clearer customer/desk colour settings and failed-save
selection recovery. A disconnected assistant shows a setup link instead of a
disabled conversation panel. Empty views offer useful next steps.

The real hosted browser verified desktop at 1440×1000 and mobile at 360×800.
Mobile document width was 360 pixels; summary values align within one pixel.
All seven menu rows measured 36 pixels, inherited the dark desk palette and
showed a two-pixel focus outline when navigated with the keyboard. The production
login contains no developer commands. Final browser console and page-error
logs were empty. Reduced-motion preference was enabled for the mobile check.

The fictional shop is Spoke Street Cycles. Its six published offers cover goods,
services and a private download; three published knowledge entries and sample
terms accompany them. The existing Plum customer theme was preserved. A real
browser-created service request reached the seller's review with its buyer note.
No quote was approved and no payment was made. The table uses “Amount,” not
“Paid,” for an unpaid quote. Test requests can expire normally.

An older open tab referenced an asset removed by a redeploy and showed a load
error; reloading recovered. Current HTML uses private/no-store caching. Seamless
continuity of an already-open tab across deployments is not verified.

Validation: type/source checks and both production builds passed. The focused
UX/database journey run passed 24 tests across five files. The final whole suite
finished with 774 passed and one local installer exit-status failure (775 total,
129 files). That exact installer test then passed unchanged in isolation in
13.03 seconds, versus 127.68 seconds for the failed case in the full run. Both
results are retained; a completely clean latest whole-suite run is not claimed.
All 56 recorded original PostgreSQL migration/auth schema hashes are unchanged.

## Initial hosted evidence

- Worker version `f48494dd-1dd3-4a50-b3e6-cc3b7b22290a` deployed with its own
  native D1 binding, assets and one-minute recovery schedule.
- Cloudflare's API reports all auth, job and runtime settings as `secret_text`.
  The Worker has no PostgreSQL URL binding.
- Real browser owner sign-in, desk reload, setup and desktop/mobile rendering
  passed. The mobile page measured 390 pixels for both viewport and document
  width. Saved browser console/error logs were empty.
- Anonymous buyer, login, auth-health and widget-script requests returned 200.
  Anonymous access to the owner desk redirected to login.
- The recovery endpoint rejected an unauthenticated request with 401. An
  authenticated request completed with zero queued work and no problems.
  Installing the schedule does not prove automatic cron delivery or recovery of
  a real hosted payment. Those remain separate checks.
- Independent remote D1 reads found one shop, one owner, a browser session and
  sandbox mode. No local histories or orders were copied into the fresh host.

A deployment guard found that Vite's local environment could add a PostgreSQL
URL to the D1 secret declaration. The upload was refused before mutation. The
binding selection now excludes it for D1, while direct ambiguous runtime
configuration still fails. The regression failed before the fix; all nine
Cloudflare settings tests passed afterward. TypeScript/source guard and the
production Worker build also passed. The earlier full database suite passed
769 tests; it was not rerun merely to relabel that total after this settings fix.

## Where the AI key belongs

On Cloudflare, use the deployed Worker's **Settings > Variables and Secrets**
and store `ANTHROPIC_API_KEY` as an encrypted secret. Main replies use
`AI_PROVIDER=anthropic` and the operator-selected `AI_MODEL_ID`. Haiku routing,
Jev and OpenAI Decisions are optional. A selected model name is not proof of
account access or a working model call.

An operator can upload these settings securely without adding the key to public
source. Follow [Cloudflare's secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/).
Do not put provider keys in browser variables, a widget or WordPress.

## Still to finish

Add the dedicated Claude key, perform current live provider and conversational
checks, verify a completed PayPal sandbox checkout and callback on this HTTPS origin,
review the fictional shop content, and complete hosted purchase/recovery checks.
Independent HTTPS embed and WordPress checks, actual scheduled delivery, model
quality, usage costs and submission acceptance remain unverified. No account
billing plan was upgraded and no hackathon project was submitted.
