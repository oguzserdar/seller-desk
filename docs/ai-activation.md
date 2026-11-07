# Activate and verify real AI

## One key, no extra routine model

For a fresh installation, `pnpm demo` generates the following model choices. In an existing installation, preserve your app, database and PayPal settings and change only these AI settings in the private server environment:

```dotenv
AI_PROVIDER=gateway
AI_MODEL_ID=anthropic/claude-sonnet-5.5
AI_GATEWAY_API_KEY=
AI_ROUTING_PROVIDER=gateway
AI_ROUTING_MODEL_ID=
AI_ROUTINE_PROVIDER=
AI_ROUTINE_MODEL_ID=
```

Fill in the blank Gateway key locally. Do not paste keys into chat, commit them, or put them in the widget. Restart the app after changes. Existing owner login, catalog, conversations and PayPal records need no migration or reseed.

OpenRouter instead uses `AI_PROVIDER=openrouter`, `AI_ROUTING_PROVIDER=openrouter` and `OPENROUTER_API_KEY`. Native Anthropic/OpenAI/Google connections use their own reply model ID/key. Routing is independent: leave it off, select native Anthropic classification, native OpenAI Decisions, or Jev through TypeSafe/Gateway/OpenRouter. Setup prepares these settings without changing the running assistant. Provider account access, model availability and usage allowance must be checked with a real call.

For local Next.js use `.env.local`. For local Cloudflare use `.dev.vars`; hosted Cloudflare uses private worker secrets. On Vercel use private project environment variables. The Gateway adapter also supports deployment OIDC. The app does not provide free inference or include anyone's subscription credentials.

## What the check proves

Owner Setup → Check AI connection runs the reply-model tool/output check, the selected decision check, then any optional routine-model check. Haiku must return a valid structured category; dedicated decision providers must also return a valid probability. Haiku does not supply native choice distributions, so the check refuses a Haiku-plus-routine configuration that cannot select the routine model. It stops on failure and never silently marks a partially checked stack as connected. The command-line equivalent is `pnpm run doctor -- --live`; it reports results without changing Setup's stored proof.

This is a protocol check. It cannot prove whether a seller's customer received a helpful answer.

## Live acceptance after the key is entered

Run sequentially with one browser/app and inspect results before broadening the batch:

1. Run the complete connection check. Fix authentication/model access errors first.
2. Review the routing plan: `pnpm exec tsx scripts/eval-routing.ts --take 32`.
3. Run it with `--run`; repeat with `--reverse` using the same model and settings. Keep failures in the report. Review the label, probability, provider confidence and latency separately.
4. Use `pnpm eval:chat -- --run --reset-fixtures` only with a separate localhost `CHAT_EVAL_DATABASE_URL` ending in `_chat_eval`. Never target the preserved shop or sandbox databases. Use `--match`, `--take` and `--repeat` for bounded batches. Review transcripts and database outcomes; the runner records the actual selected reply model and routing trace per turn.
5. In the actual browser try product questions, service constraints, digital access, unclear payment, a human request, a corrected pending request, seller proposals and false claimed approval. Refresh and stop a turn. Verify saved input, completed replies, current orders and approval state.
6. Compare a chosen routine model against the main model before enabling it. Do not equate model probability with measured accuracy or infer savings from a passing unit test.

## A daily budget for a shared key

A public demo, or any installation whose key you pay for while others use it, can set a
daily dollar budget:

```sh
AI_DAILY_BUDGET_USD=3
```

Each model call's reported tokens are priced and added to today's total. Once the total
reaches the budget, the assistant is off until midnight UTC: customers see the plain shop,
can still add items and pay with PayPal, and the owner's Setup says why. Shop tests count
against the same budget. Nothing is measured when the setting is absent.

Prices for the suggested models are built in (`src/server/ai/spend.ts`, with their source).
For any other model, give its price in US dollars per million input and output tokens:

```sh
AI_PRICE_PER_MILLION_TOKENS=0.5,1.5
```

A budget with no known price keeps the assistant off rather than counting calls as free.
Input tokens include cached reads at the full input price, so the estimate errs high. The
per-buyer and per-shop message limits still apply on top.

## Failure behavior

The selected router gets one request and at most 2.5 seconds. Missing, uncertain or failed decisions use the configured main reply model, without replaying tools. User cancellation propagates. A failed reply request remains a visible failed turn; there is no canned successful response. A saved seller answer remains available for the existing fenced recovery worker. Routing does not authorize payment, fulfilment, a refund or a seller proposal.

The default probability threshold is 0.95. Optional routine-model settings are empty by default, so routing guides handling rather than saving reply-model cost. Haiku classifications supply guidance but never fabricate a probability or activate the probability-based routine-model path. Its additional request may add latency; actual performance and customer benefit remain to be measured after credentials are supplied.

## Native Claude with one key

Preserve all database, PayPal and owner settings. For a local installation, edit only the AI entries in the private `.env.local`:

```dotenv
AI_PROVIDER=anthropic
AI_MODEL_ID=claude-sonnet-5-5
ANTHROPIC_API_KEY=
AI_ROUTING_PROVIDER=off
AI_ROUTING_MODEL_ID=
AI_ROUTINE_PROVIDER=
AI_ROUTINE_MODEL_ID=
```

Enter the Anthropic key after the equals sign. For optional Haiku classification, change `AI_ROUTING_PROVIDER=anthropic` and `AI_ROUTING_MODEL_ID=claude-haiku-5-5`. It uses the same Anthropic key. Sonnet remains the reply model.

For native OpenAI Decisions, use `AI_ROUTING_PROVIDER=openai`, `AI_ROUTING_MODEL_ID=gpt-6-luna` and a separate `OPENAI_API_KEY`. This calls `/v1/decisions`, not `/v1/responses`. Jev remains available with `typesafe`, `gateway` or `openrouter` routing and the matching provider key. Claude credits do not establish access to these other providers.

## SDK upgrade record, October 15, 2026

Installed pins: `ai@7.0.141`, `@ai-sdk/react@4.0.145`, `@ai-sdk/provider@4.0.27`, `@ai-sdk/openai@4.0.94`, `@ai-sdk/anthropic@4.0.80`, `@ai-sdk/google@4.0.96`, `@ai-sdk/typesafe-ai@3.0.19`, and `@openrouter/ai-sdk-provider@3.1.0`. Application calls use `experimental_decide` and `decisionModel`; the decision API remains experimental.

OpenRouter 3.1.0 bundles the older experimental state contract despite declaring AI SDK 7 support. The committed pnpm patch upgrades its factory/model method to the decision contract, converts normalized text/JSON parts back to the OpenRouter wire state and rejects unsupported files before sending a request. The patch is installed through `pnpm-lock.yaml`, includes no credentials, and is required for this dependency pin. Do not remove it without checking the replacement adapter's types and wire-state tests. Other reply-provider methods are unchanged.

Sources: [AI SDK decisions](https://ai-sdk.dev/docs/ai-sdk-core/decisions), [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions), [OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider). Network-boundary tests use explicit provider refusals, not generated successful customer answers. Live model accuracy, latency and cost remain unverified until real provider calls are run.
