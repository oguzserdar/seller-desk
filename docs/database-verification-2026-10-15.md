# Database verification, 15 October 2026

This record establishes the PostgreSQL/D1 backend scope. It does not clear the separate native-model, hosted-demo or hackathon-submission requirements. Older dated AI results remain historical evidence for their original models and environments.

The full sequential source suite passed **769 tests across 127 files**.

## Real storage and common behavior

The shared tests execute the same public seller/buyer operations against PostgreSQL and actual Miniflare/workerd D1 bindings. Database results are inspected independently. No successful model reply is supplied by these storage tests.

| Area | Checked behavior |
| --- | --- |
| Checkout | Goods, services, digital and mixed quotes; concurrent checkout; last-unit contention; terms/price/revision changes; seller takeover; final-audit rollback |
| Payment | Shared provider driver; replaced executor fences; late capture; duplicate effects; lost create/capture responses; wrong amount/payee; pending and declined instruments; verified webhook deduplication; queued recovery |
| Fulfillment | Pickup, timing and finished work stay separate from payment; failure rolls back task/audit together; original digital terms, private bytes, expired/revoked grants and recovery without another charge |
| Conversation | Revocable buyer capabilities, one-time handoff, ordered 40-message windows, interrupted input, seller takeover, exact seller messages and replaced owner-turn claims |
| Knowledge | Private exceptions stay private; explicit publication; source/review revision guards; publication receipts; guide/instruction history; failed previews retained without invented answers |
| Installation | Better Auth sign-in, disabled public signup, concurrent first setup, atomic credential/shop creation, password reset and session revocation, including reused unowned accounts |
| Scale and limits | Fifty-product reviewed imports; 120-product catalog; 120 saved approval references across 40 messages; ten-line goods/digital carts with bounded native query counts |
| Reporting | Whole-shop totals separated by currency; repeated-midnight calendar boundary; current work counts independent of desk display limits |
| Isolation | Allowlisted simulation snapshot; separate fixture identity; occupied/source/sandbox targets refused; prior partial results preserved |

Both schemas expose the same 44 logical row types and business relationships. D1 has two additional native metadata tables for counters and installation identity. PostgreSQL's existing SQL migration history is unchanged.

## Actual browser checks

The production D1 Worker bundle ran locally on one server with one browser session. PayPal was explicitly simulated and AI disconnected.

- Goods: a USD 35 purchase reached paid order #1001, with pickup still owed.
- Digital: a USD 25 purchase reached #1002. The protected download request completed and its database download count became one.
- Reviewed service: the buyer sent a scope request, the owner approved the exact work, and a USD 120 purchase reached #1003. Timing and work remained unfinished; payment did not imply booking or completion.
- The owner signed in, reloaded the desk, published a knowledge entry and opened its first saved version. Setup correctly identified Cloudflare D1 and the missing AI connection. The installation page rendered.
- Desktop at 1440×1000 and mobile at 390×844 were inspected. The measured mobile scroll width matched the viewport. Saved browser console/error logs were empty. Stable receipt captures were used; an immediate transition capture is not layout evidence.
- Independent D1 queries found three orders, three captures, three checkout audit rows, one active grant with one download, expected unfinished tasks and no foreign-key violations. The local installer was rerun without resetting the shop.

The dated browser captures for this verification are retained in its private evidence record. Current interface: [seller desk](media/seller-desk.png).

[Current service-order layout on a phone](media/service-order-mobile.png). This fresh capture uses an independent fictional local order; it does not replace the dated purchase evidence above.

The PostgreSQL production app was checked separately. Its original three browser-test orders stayed unchanged. One additional goods purchase reached #1004, the owner could sign in/reload, and independent SQL found four orders and four captures. Existing application and PayPal sandbox databases were not reset.

## Migrations and remote D1

The official Wrangler runner was tested with the actual application baseline. A real fictional shop and purchase populated it before upgrade. After migration, stored record/file digests matched, foreign keys were valid, a new native binding restored the paid order, and rerunning migrations changed nothing. A separate test exercises file rollback and resumption after migration failure.

The previously created empty Seller Desk D1 resource also received the three guarded migrations on Cloudflare. An official Wrangler remote binding read its application tables and clock. An intentionally invalid native batch rolled back its first effect and left zero proof rows; foreign-key checks were clear. No application Worker or owner was deployed by this database check. No unrelated project resource was changed.

## Reproduced failures fixed

The port caught existing PostgreSQL defects as well as D1 implementation failures. Regression evidence includes stale payment executors committing orders; a missing catalog owner check; separate fulfillment/audit commits; orphan credentials after setup failure or concurrent setup; retained old sessions during account reuse; a daily-total boundary excluding the first repeated midnight hour; D1 parameter overflow in catalog/history reads; mismatched local persistence roots; and metadata written to a refused sandbox simulation target.

The implementation uses native transactions or batches for whole named operations. It does not emulate a PostgreSQL transaction callback on D1, translate SQL at runtime, clone a live database for tests, repeat effects from saved receipts or fall back between backends.

## Still unverified

The dedicated native Anthropic credential is absent. Sonnet replies, optional Haiku classification, live model-driven simulations and current conversation-quality edge cases require that key. Jev and OpenAI Decisions remain optional; installed adapters are not evidence of model/account access.

An application deployment, hosted AI streaming/cancellation, hosted PayPal sandbox approval/webhooks, remote scheduler delivery, independent HTTPS widget framing and WordPress installation need their own checks. Free-source installation is available; free hosted operation has not been established. Shipping, refunds and actual calendar booking continue in the seller's existing tools. No publication or hackathon submission is claimed.
