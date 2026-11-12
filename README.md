# Seller Desk

**Your agentic sales team, open 24/7.** An open-source AI sales agent for businesses that take PayPal.

It answers customers from your catalog, asks you only what it can't know, and closes the sale with a verified PayPal payment.

**Who it's for:** any business that takes PayPal and still answers customers by hand, such as a bike repairer, a maker or a tutor. A question that arrives at 9 pm and waits until morning is often a sale lost.

**The one rule:** the AI talks, the server decides money. The model cannot set a price, change a total or mark anything paid. A haggler, a fake "system" message, a tampered amount, a forged webhook and a double payment all end the same way: refused, or one order and one payment.

[Live demo](https://sellerdesk.dev) · [Try the shop](https://sellerdesk.dev/buy) · [How to test it](docs/how-to-test.md) · [How it learns](#it-learns-from-the-answers-you-give) · [Install](#deploy) · [Guide](docs/guide.md)

![Seller Desk in motion: the shop catalog, a quote with Pay with PayPal, a service order and the owner's desk](docs/media/hero.gif)

## For judges: pick your time

No install. The demo shop is fictional and payments run in the PayPal sandbox.

| You have | Do this | You see |
|---|---|---|
| **30 seconds** | Open [sellerdesk.dev](https://sellerdesk.dev) | One sale playing out, from a question to a checked PayPal payment |
| **2 minutes** | Open [the shop](https://sellerdesk.dev/buy) and ask "Can you replace my brake cable by Tuesday?" | An answer from the real catalog, and a quote with **Pay with PayPal** |
| **5 minutes** | On the home page press **Look around the owner's desk** (no login, read-only) | Paid orders, the customers waiting for an answer, and Setup with both PayPal paths |
| **15 minutes** | Sign in as the owner with the login in the submission's testing instructions, then follow [the checklist](docs/how-to-test.md) | Answer a customer, send a quote, pay it as a sandbox buyer, watch the order appear |

## See it work

![How one sale works: the customer asks, Seller Desk reads the catalog, the owner answers only what it can't know, the customer approves in PayPal, Seller Desk checks the payment and makes the order, the owner sees what is still owed](docs/media/diagram-sale.png)

<!-- Demo film: paste the GitHub-uploaded mp4 URL on its own line here, with a thumbnail linking to the full film on YouTube, once both are published. -->

**1. The customer asks.** A product, a custom repair, a budget or a deadline. The assistant reads
your catalog and brings you the question it can't answer from your published information.
Customers can also browse and build a quote directly.

![The current shop catalog, with goods, services and a download](docs/media/buyer-catalog.png)

**2. You control the quote.** Prices come from your catalog or your reviewed service quote.
The customer sees the scope, quantity and total before paying.

![The customer reviewing brake pads, the total and PayPal checkout](docs/media/buyer-quote.png)

**3. PayPal takes the payment.** The server checks it before creating the order. Paid is not done:
the appointment time and the work stay open until you finish them.

![The current service order, showing its payment and unfinished work; captured with a simulated local payment](docs/media/service-order.png)

**4. You see what needs you.** Questions, pickups, service work and payments to check stay
visible in one desk, with the orders in an AG Grid table you can sort, search and export. The
desk assistant can read order records when you ask what needs attention.

<picture>
  <source media="(max-width: 600px)" srcset="docs/media/seller-desk-mobile.png">
  <img alt="The seller desk: paid orders, what needs the owner, and a customer question waiting for an answer" src="docs/media/seller-desk.png">
</picture>

**“Did my payment go through?”** The assistant checks the payment record. It can recover a
valid download without creating a second charge. See [payment recovery](docs/proof-matrix.md).

## Works with the shop you already have

![Seller Desk connects to any website with one script tag, to WordPress with a free plugin, and reads a WooCommerce store's public catalog](docs/media/diagram-connect.png)

- **Any website.** Paste one script tag. The "Ask the shop" button appears only on websites
  you allow.
- **WordPress.** Download the free plugin from the desk, upload it, paste your Seller Desk
  address and run its connection check. No theme editing.
- **WooCommerce.** Point Seller Desk at your store. The assistant searches your public catalog
  for current prices, stock and options, and sends customers to your product page; checkout,
  shipping and refunds stay in your shop. No admin key needed.
- **Your own pages.** Add your booking page or returns form to the shop's knowledge, and the
  assistant can offer it as a button.

![The desk's Install page: download the WordPress plugin, connect it, allow your website, and the optional WooCommerce catalog](docs/media/website-install.png)

## It learns from the answers you give

<picture>
  <source media="(max-width: 600px)" srcset="docs/media/diagram-learn-mobile.png">
  <img alt="Example learning cycle: your answer is reviewed, a private exception stays private, you approve the reusable fact, and the next customer can receive it" src="docs/media/diagram-learn.png">
</picture>

![The current learning workspace before the first review; its sample is explicitly labeled Example, nothing is published](docs/media/learning-screen.png)

This improves the shop's approved knowledge; it does not retrain the model.

When the shop answers a customer's question, the owner can press **Review this answer**. A
review model reads that question and answer next to the shop's published facts, terms and
products, and drafts:

- **a fact for everyone**, such as "the side entrance is step-free", in public wording;
- **a one-off favor**, such as "Isabel can pick up until 18:00 this Friday", marked as not
  publishable;
- **open questions and conflicts** with rules the shop already published.

Nothing goes public until the owner approves it. A conflict with the checkout terms or a
product listing blocks publishing. Each approved fact is versioned and linked to the review it
came from, and the owner can first try it on a typed customer question to compare the old and
new reply. The next customer then gets the answer without the shop being asked again.

Owners can also write standing instructions for the assistant, preview them side by side,
publish them and roll back to an earlier version.

## Try the hard questions before customers do

In your desk, open **Knowledge → Test your assistant**. Try a product question,
an impossible deadline or a longer conversation. Add a seller reply, approve a
service scope or authorize an exact fictional purchase. Ask it to recover a lost
payment response, then check that there is one payment and one order. Or let a
simulated customer play a part: a haggler, a buyer pasting fake system text, a
firm budget and more, written by your model from your own offers. Every test
then checks that quotes kept your published prices and stayed within stock.

The test uses your real connected model and published shop facts in a separate
fictional shop. Compare published instructions with a saved change before you
publish it. Read the actual conversation, actions and database outcomes. A finished
run is not automatically a pass, and the expectation you write never reaches the
model. Your live stock, customers and orders stay untouched.

[How seller tests work](docs/seller-tests.md)

## How it uses PayPal and AI

![What happens to one customer message: router, answer model, tools reading live records, server rules, answer from the records](docs/media/diagram-turn.png)

**What the AI is.** A tool-using agent over the shop's own records. There is no RAG, no vector
database and no fine-tuning. For every message:

1. **Router (optional).** Jev or OpenAI Decisions labels the message as routine, recovery,
   complex or a request for the seller, with probabilities. Optional Haiku classification supplies
   the same handling categories without probability-based answer-model switching. Only a routine label above 95% may
   switch the turn to a cheaper model. The label never approves anything, and if the router
   fails or takes over 2.5 seconds, the main model answers.
2. **Answer model with tools.** AI SDK 7 connects to Vercel AI Gateway, OpenRouter or a native
   provider such as Anthropic or OpenAI. Your chosen reply model reads live data through tools: the catalog (given whole up to 40 offers,
   searched by words above that), the shop's approved facts, the customer's orders and
   payments. It acts only through tools such as `propose_quote`, `ask_seller` and
   `restore_download`.
3. **The server decides.** Prices come from the shop, payment status from PayPal, stock and
   permissions from the database. The model cannot set a price or mark anything paid.

The learning review above is a separate, owner-triggered model call with a structured answer.

**Agentic commerce, with limits.** Each installation is also a connector (MCP) and an Agent
Skill for the owner's own AI apps. Claude, ChatGPT, Codex or Cursor can read who is waiting,
conversations, orders and offers. The connector is read-only: they cannot message customers,
change prices or move money.

![Nothing is released until PayPal confirms it: the server retrieves the order, checks it, captures once; recovery job and verified webhook as backups](docs/media/diagram-paypal.png)

**PayPal.** Checkout uses the Orders v2 API: create, retrieve and capture. Before an order or a
download is released, the server retrieves the PayPal order itself and checks the amount,
currency and recipient. Webhooks are verified with PayPal's signature check. If a customer's
return is interrupted, a recovery job finds or completes the payment and records one order,
never a second charge.

## Receipts: every PayPal call, and what the server checks

| Step | PayPal call | What the server does around it |
|---|---|---|
| Sign in to PayPal | `POST /v1/oauth2/token` | Client credentials stay on the server |
| Start checkout | `POST /v2/checkout/orders` | Amount comes from the saved quote, never from the chat. A `PayPal-Request-Id` saved before the call makes a retry safe |
| Customer returns | `GET /v2/checkout/orders/{id}` | Merchant, amount and currency must match the quote before anything else happens |
| Take the money | `POST /v2/checkout/orders/{id}/capture` | Captured once. Paying twice or reloading still ends in one order |
| Backup | Webhook, checked with `POST /v1/notifications/verify-webhook-signature` | An unsigned or forged event is refused. A lost return page is recovered by a scheduled job |
| Owner lookups (optional) | PayPal Agent Toolkit: `get_order`, `list_transactions`, `list_invoices`, `get_invoice`, `list_disputes`, `get_dispute` | Read-only, for the owner's desk assistant |

### Two ways to PayPal, kept apart

Seller Desk uses PayPal's own [Agent Toolkit](https://github.com/paypal/agent-toolkit) and its own checkout code, each for what it is good at.

- **Reading: PayPal's Agent Toolkit.** With `PAYPAL_AGENT_TOOLKIT=on`, the owner's desk assistant can ask PayPal directly: "what does PayPal say about order 1006?", "any open disputes?". The toolkit is configured with read actions only, and the tools it returns are checked against a fixed list again before the model sees them.
- **Moving money: this server's code.** A model that can call `create_order` or capture a payment decides money. Here it cannot: checkout is server code with a saved quote, a per-attempt request id, a merchant, amount and currency check, and a verified webhook.

### What is real and what is simulated

| | Hosted demo | `pnpm demo` on your machine |
|---|---|---|
| AI answers | Real model | Real model if you add a key; plain catalog without |
| PayPal | Real PayPal sandbox | A built-in stand-in, no account needed |
| Shop and customers | Fictional | Fictional |
| "Test your assistant" | Real model, throwaway copy of the shop | Same |

## Try it locally

![Try it on your own machine: pnpm demo sets up a local database, a demo shop with an owner login, and the app on port 4310](docs/media/diagram-local.png)

Needs Node 24+ and pnpm 10.2.1.

```sh
pnpm install --frozen-lockfile
pnpm demo
```

This creates a private local database and a fictional shop, then prints the shop
address and an owner login. Without an AI key the shop still sells; connect a model with
the [AI guide](docs/ai-activation.md).

For a local **Cloudflare D1** installation instead of PostgreSQL:

```sh
pnpm demo:d1
```

This keeps its own fictional database and private owner login. See the
[database guide](docs/database-portability.md). Both demos preserve existing records.
AI requires a provider key; installation never invents assistant replies.

## Deploy

Install in your own account. Choose one host:

[<img src="https://vercel.com/button" alt="Deploy with Vercel" height="32">](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Foguzserdar%2Fseller-desk&project-name=seller-desk&repository-name=seller-desk&env=APP_MODE%2CDATABASE_KIND%2CBETTER_AUTH_SECRET%2CJOBS_SECRET%2CINSTALL_TOKEN%2CENABLE_EXPERIMENTAL_COREPACK&envDefaults=%7B%22APP_MODE%22%3A%22sandbox%22%2C%22DATABASE_KIND%22%3A%22postgres%22%2C%22ENABLE_EXPERIMENTAL_COREPACK%22%3A%221%22%7D&envDescription=Create+a+separate+Neon+PostgreSQL+database+in+the+installation+flow.+Supply+three+different+random+secrets+of+at+least+32+characters.+After+deployment%2C+create+the+owner+at+%2Fowner%2Fstart.+AI+and+PayPal+connect+afterward.&envLink=https%3A%2F%2Fgithub.com%2Foguzserdar%2Fseller-desk%2Fblob%2Fmain%2Fdocs%2Fdeploy-vercel.md&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%5D)
[<img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" height="32">](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Foguzserdar%2Fseller-desk)

- **Vercel:** a separate Neon PostgreSQL database. [Installation guide](docs/deploy-vercel.md).
- **Cloudflare:** a separate D1 database, with scheduled payment recovery included. [Installation guide](docs/deploy-cloudflare.md).

Both prepare the database and open protected owner setup. Connect your AI provider and
PayPal account afterward; credentials stay on your server. Vercel also needs a frequent
recovery scheduler. Hosting, AI usage and payment processing have separate costs.
See [installation readiness](docs/readiness.md) for the checks still required.

<!-- Publication candidate: publish reviewed public source and verify each hosted installer before claiming end-to-end installation. -->

## Docs

- [Full guide](docs/guide.md): settings, WordPress, WooCommerce, PayPal sandbox and the rules the server enforces
- [How to test it](docs/how-to-test.md): a 15-minute checklist with expected results
- [What works today](docs/readiness.md) and the [verification record](docs/proof-matrix.md)

## Status

A hackathon build. Local demos use simulated payments; the hosted demo uses PayPal sandbox.
AI conversations need a configured provider. UI screenshots show the current app with fictional
shop data and simulated local purchases; explanatory diagrams are examples, not transcripts.

Checkout covers pickup goods, quoted services and small downloads. Shipping, refunds and
booking stay in your existing tools. See [what works today](docs/readiness.md) and the
[verification record](docs/proof-matrix.md) for completed checks and unfinished work.

## Built with

PayPal Orders v2, PayPal webhooks and PayPal's Agent Toolkit · Vercel AI SDK 7 with Claude
(Anthropic), and any OpenAI, Google or gateway model · Model Context Protocol and Agent Skills ·
Next.js 16 and React · AG Grid Community · Drizzle ORM on Cloudflare D1 or PostgreSQL · Better
Auth · Cloudflare Workers or Vercel.

Built for the PayPal AI Hackathon 2026. Not made by or affiliated with PayPal.

## License

[MIT](LICENSE). Third-party components keep their own licenses; see
[the notices](THIRD_PARTY_NOTICES.md).
