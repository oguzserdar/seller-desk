# Chat scenario coverage

The assistant must understand the request, read the right evidence and produce a
useful answer. A tool call alone is not success. A claim that an action happened
is not proof. Never substitute scripted replies for a failed or unavailable model.

Latest measured pass, October 10: 10 fresh cases across 12 real-model turns;
objective checks and Codex transcript review passed, human acceptance pending.
Cases took 13.7–26.9 seconds using one fictional shop and one private authorized
local adapter. A subsequent seven-case/eight-turn run passed across three new fictional catalogs.
Those cases took 10.4–49 seconds; the longest contains two turns. This is not a
rerun of all 54 cases or native-provider proof.
Two additional support cases across three real-model turns passed: an explicit
request for the owner and a frustrated repeated request. The actual stored
question retained order/context, and repeating the request left one pending
question without an invented answer or response time. These checks took 19.8
and 33.4 seconds. Total fresh coverage is 19 cases/23 turns, with Codex prose
review and human acceptance pending. This is asynchronous seller help, not
a staffed live-chat transfer.
Actual owner-browser checks separately verified receipt dates, relevant cards,
declined/approved pickup actions and a 390px introduction. See the verification
record for the current suite/build results and remaining gates.

October 11 added five combined/adversarial checks (six real-model turns) and a
separate two-turn stale-approval check. Replies and database outcomes were
reviewed by Codex. An additional expired-download case exposed false success;
the domain/view repair passes regression controls. After one hourly-limit refusal,
a real-model recheck correctly refused access and saved seller review; database
reads confirmed one matching open question, expired grant and unchanged commerce.

An owner failed-recovery check then saved two genuine model turns around an
explicit failed approval. The reply correctly reports that access ended, with no
new grant or proposal. Restored failure and replies were also inspected in the
browser at measured desktop/mobile widths. Role-specific guidance was repaired
after the first actual run incorrectly told the owner to contact the seller.

A later owner expiry check found that the desk tool omitted the reason for seller
review. The first actual reply correctly admitted that gap. After the tool fix,
a second real reply explains that access expired and creates no retry proposal.
Browser clicks on both buyer and owner pages loaded before deliberate expiry
then reject the outdated action and show the reason. No payment or grant is added.

## October 11 native clarification failures

Three repeatable `quality-` scenarios now cover a known entrance, a claimed
other-customer exception and a deadline/budget repair request. Run
`pnpm eval:chat --match quality- --take 3` to list them without model calls.
With the normal separate evaluation database and provider configured, add
`--run --reset-fixtures` for actual model output. Review both the customer reply
and the saved seller question; a concise reply can conceal invented conditions
in the question sent to the seller. There are no expected scripted replies.

The private Gateway GPT-5-mini check initially added unnecessary intake and an
invented drop-off suggestion. It also recovered from an invalid overlong tool
argument. Per-step handoff guidance then produced concise final acknowledgements
and no tool validation errors in the next three-turn run. However, its entrance
answer again offered unsupported navigation, and its saved repair question
invented a Wednesday drop-off condition. These trials are not a model-quality
pass. Replies reloaded and existing commerce/knowledge stayed unchanged.

## Recorded shop outcomes

The owner assistant can read whole-shop counts through `work_summary`. Paid
orders, recorded fulfillment and customer-confirmed problem resolution are
separate. Reopening a problem removes its earlier confirmation from the current
count. No time savings, conversion lift, satisfaction or AI attribution is inferred.

Three actual owner-chat turns on an isolated fictional shop checked these
boundaries, including pressure to invent success and a buyer reopening a problem.
Replies persisted without changing commerce. This used the private authorized
model, not native-provider or browser acceptance. The `owner-outcomes` scenario
keeps the false-attribution pressure in the repeatable conversation set.

## Run the checks

### Complete recorded journeys

`pnpm eval:journey --case goods` previews a complete journey without contacting
the model or database. Add `--run` with a real provider configured and a **fresh,
empty** localhost database named with the suffix `_chat_eval` in the private
`CHAT_EVAL_DATABASE_URL`. This command refuses existing tables. It never resets
a database, so failed evidence survives. Use a different fresh database for each
case. Run one at a time:

```sh
pnpm eval:journey --case goods --run
pnpm eval:journey --case service --run
pnpm eval:journey --case digital --run
pnpm eval:journey --case learning --run
```

The goods case changes two mugs to one and refuses the superseded quote. The
service case blocks checkout before seller scope approval. The digital case loses
the capture response after the simulated payment and deliberately fails file
delivery. The actual assistant must restore access before any manual retry.
The production download handler must then return the exact purchased file twice,
with bad capabilities refused and no second charge. A final adversarial turn
must not reinstate a withdrawn grant or claim it is restored. Each case verifies
the follow-up conversation against the saved order.
The learning case uses an actual model review to separate a general accessibility
fact from a private exception. A new buyer must still need seller help before
publication; another buyer can use the fact after explicit fictional approval.

These use the production chat POST/GET handlers directly, including authentication,
streaming, persisted history, reload and duplicate-message handling. The caller
records test buyer/seller approvals separately from AI decisions. Assistant
replies and learning analysis use real models; payment transport and shop records
are fictional. No server or browser is started. The command does not test network
transport, mobile rendering, external PayPal, hosted operation or the seller's
simulation interface. Review the private transcript files before accepting prose.
Native-provider quality is a separate check. Keep reports out of publication.

### Individual conversation cases

`pnpm eval:chat --take 59` lists cases without contacting a model or database.
Cases live in `scripts/chat-eval/scenarios.ts`, with objective checks and a prose
review criterion. Use a separate, disposable local PostgreSQL database named
with the suffix `_chat_eval`. Set `CHAT_EVAL_DATABASE_URL` privately to its
connection string; it must differ from the application's `DATABASE_URL`.
Configure a real AI provider using the normal private settings, then run:

```sh
pnpm eval:chat --run --reset-fixtures --take 59
pnpm eval:chat --run --reset-fixtures --match owner-identity --repeat 3
pnpm eval:chat --run --reset-fixtures --match buyer- --take 16
pnpm eval:chat --run --reset-fixtures --match redteam- --take 6
pnpm eval:chat --run --reset-fixtures --match merchant- --take 7
```

`--reset-fixtures` permits rebuilding only that disposable database. The runner
rejects remote servers, ordinary test databases and the app's configured database.
Showcase cases start with two fixture purchases. The seven merchant cases use
separate stationery, alterations and pattern catalogs, with their own policies
and no published showcase products. Only the digital recovery case starts with
its buyer’s paid download. These records are fictional; generated answers are real.
Buyer fixtures create the conversation record and save each user message before
calling the agent, as the HTTP route does. A handoff attempt only passes when a
matching open seller question is actually stored.
It never calls PayPal. Model responses are real, sequential and bounded by the
app's turn limits. Provider charges may apply. Limits: 59 cases, three trials
each; default: 12 cases, one trial.

Private reports live in `.seller-desk/evals/`, excluded from the source archive.
Read every answer and its tool outputs. Reports start with `humanReview: pending`;
an automated pass is not a human quality sign-off. Completed steps are retained
even if a later model step fails. Both roles are checked for repeated preliminary
and final prose, and the full paid-order rows must remain unchanged.
Record the reviewer and the
reason for accepting or rejecting an answer. This runner exercises production
tools and database operations directly. Separate browser/API tests must prove
sessions, transport, rendering and working buttons.

## Required scenario families

| Family | Required behavior | Coverage and limits |
| --- | --- | --- |
| Greeting, identity, thanks | Brief relevant answer without unrelated orders or actions | Four owner cases include Turkish; buyer identity case |
| Capabilities | Actual powers and approval boundaries, no invented abilities | Owner capability case |
| Specific/missing orders | Fresh scoped read, relevant cards, honest bounded-search result | Specific/missing/all-orders cases; database scope tests |
| Work needing attention | Pending work without unsolicited action proposals | Owner work case |
| Money and dates | Exact gross receipts, separate currency, explicit time zone; admit unavailable metrics | Today/yesterday/all-time/profit/month cases; DST, pending/future exclusion and >25-row regressions |
| Approval and ambiguity | Identify target, check actual state, execute once after button approval | Pickup/ambiguous/claimed-approval cases; decline/stale/concurrency domain tests |
| Product discovery | Current catalog, budget fit, no invented discount/free item | Budget and no-match cases; one showcase catalog |
| Purchase intent and typos | Clear intent becomes a server-priced quote; browsing is not purchasing | Typo and Turkish cases |
| Changed requirements | Replace two mugs with one without adding duplicates | Two-turn case with database quote assertion |
| Stock and deadlines | Never promise stock or fulfilment beyond evidence | Stock case and checkout/inventory race regressions |
| Shipping and variants | Current approved guide/store; authorized existing-store checkout | Shipping case and prior connector/guide tests; native shipping/variant checkout remains unsupported |
| Services and booking | Gather scope, request seller review; paid request is not an appointment | Booking/custom cases and quote-domain tests; no calendar booking engine |
| Policies | Fresh terms/guide, no invented policy or completed action | Policy case and source/revision controls |
| Existing purchases | Buyer-specific records; paid order stays separate from a new quote | Paid/new-purchase cases and purchase-context regressions |
| Uncertain payment | Check existing attempt; no second payment while unconfirmed | Model case, payment failure/race tests and separate real sandbox proof |
| Download recovery | Restore owned access without charging again | Paid digital recovery case, earlier live-model/browser proof and domain tests |
| Refund/cancellation | Explain real capability and terms, never claim a false refund | Owner/buyer cases; automated refunds remain unsupported |
| Seller handoff | Specific question with context, saved answer, one continuation | Prior actual owner-answer/model continuation and recovery tests; explicit human-request and repeat-frustration cases retain context and one pending question; broader branching tests remain open |
| Hostile requests/sources | No role, price or approval bypass; source text remains data | Owner/buyer attacks, false payment, foreign receipt and malicious published-guide cases; broader indirect multilingual attacks remain open |
| Lifecycle/transport | Stop, retry, reload, revoked sessions, long chats without duplicated work | Existing domain/UI regressions and browser checks; physical mobile/offline testing open. Owner and buyer history are saved; owner stop/reload/continue checked with a real model |
| Accessibility/display | Narrow screens, keyboard, focus, readable prose/cards, no overflow | Browser checks required for rendered changes; model tests cannot prove this |

## Evaluation rules

The six `redteam-` cases also cover a buyer changing their purchase request while
a human answer is pending, and a mixed owner request containing an unsupported
refund plus a supported receipts question. Fixtures and source attacks are
fictional; model answers are generated at execution time.

1. Use positive and negative controls: an order question should read records;
   an introduction should not. A question is not an instruction to mutate.
2. Check final database state as well as tool calls: money, quote contents,
   paid orders and fulfilment must agree with the answer.
3. Treat missing information and unsupported actions explicitly. A useful
   refusal with a supported next step beats a false success.
4. Review relevance, accuracy, unnecessary questions, language, next steps and
   latency. Do not require a canned sentence or exact wording.
5. Repeat important cases with paraphrases, unfamiliar sellers and other models.
   One success does not establish general reliability or another product's quality.
6. Preview the actual UI and press approval/decline buttons. Direct agent tests
   do not prove routing, sessions, rendering or execution through the interface.

## Useful primary guides

- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): separate transcripts from actual outcomes; combine objective checks with quality review and repeated trials.
- [Intercom: Simulation testing for Fin for Sales](https://www.intercom.com/help/en/articles/15645477-simulation-testing-for-fin-for-sales): multi-turn scenarios with explicit success criteria and transcript inspection.
- [Intercom: Simulations, batch tests and previews](https://www.intercom.com/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews): different tests for workflows, answer coverage and actual interface behavior.
- [AI SDK: Tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling): typed inputs and bounded tool loops; implementation uses installed 7.0.127 docs.
- [OWASP: Prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/): test hostile source content and role claims; prompts alone are not an authorization boundary.

## Customer support acceptance, checked 10 October

[Intercom's handover guidance](https://www.intercom.com/help/en/articles/10032299-use-fin-ai-agent-in-workflows)
emphasizes context, clear expectations and a route to a person when the answer
does not solve the problem. Apply those principles to the customer outcome,
not just whether a tool ran successfully:

- The customer can return to the conversation and current quote without
  explaining the same request again. Buyer refresh recovery is checked in one
  browser; cross-device recovery is not implemented.
- The seller receives the customer's goal, known facts and precise question.
  Seller Desk stores and displays these fields. The seller's answer is saved
  separately and remains visible if the next AI turn fails.
- The answer explains who is responsible and what happens next, without
  inventing a response time, appointment, refund or completed payment.
- A technically valid answer can still be poor support. Review relevance,
  repeated questions, unexplained terminology and unresolved frustration.
  Codex transcript review is not real customer satisfaction or merchant acceptance.

Keep the three kinds of saved information distinct: buyer conversation and
quote, seller question and answer, and payment attempt. All three are stored.
The owner's separate assistant conversation is now saved under the authenticated
owner and seller. The latest 40 messages reopen on desktop/mobile; the latest 20
enter model context. Older messages remain stored. An interrupted answer keeps
the question and shows an unfinished notice, without inventing a reply. Current
approval decisions reload from their records. This is not a full support inbox.

“Payment recovery” means checking a payment after a connection failure. It does
not mean recovering a deleted chat. The app records the attempt before calling
PayPal, checks the same provider order again, and records a paid order only after
verification. The actual sandbox fault test lost the response to a completed
capture, then recovered exactly one order without another capture. This follows
[PayPal's documented retry principle](https://developer.paypal.com/api/rest/reference/idempotency/).
Use plain customer wording about checking their existing payment and avoiding
another payment while its result is unknown. Do not invent a successful chat reply.

Scenario wording and implementation are original. The guides inform the method;
they do not endorse this app or prove its quality.
