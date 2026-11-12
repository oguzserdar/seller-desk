# How to test Seller Desk

## Fastest: the hosted demo

No install and no AI key. The assistant runs on the demo's own server.

- Start here: <https://sellerdesk.dev>
- The shop: <https://sellerdesk.dev/buy>
- The owner's desk, read-only, no login: press **Look around the owner's desk** on
  <https://sellerdesk.dev>
- The owner's desk, to answer and send quotes: <https://sellerdesk.dev/owner/login>, login in
  the Devpost testing instructions
- Payments go through the PayPal sandbox. No real money moves. Use the sandbox buyer
  login in the Devpost testing instructions.

The shop is a fictional bike shop. Try sections 3 and 4 below on it. The assistant has a
spending limit so the demo stays available until judging ends.

### Insights, built on AG Studio

Open the read-only desk (no login), then **Insights** in the sidebar, or go to
<https://sellerdesk.dev/owner/insights>.

| Try this | You should see |
| --- | --- |
| On **Sales**, tap the **Brake service** bar | The whole page filters to that product: its orders, its revenue. Tap again to clear |
| Press **Ask the analyst**, then **How is the shop doing?** | An answer from the shop's own figures, with each figure it read listed as a step |
| Ask: "Add a chart of units sold by product to this page." | The analyst hands the job to Studio's Page and Widget agents and a new chart appears |
| Open the **Assistant** tab | **What the analyst did** counts questions, figures read, dashboard changes and hand-offs, and states that no money changed |
| Press **Edit dashboard** | Studio's own editor and data panels; changes last for your visit only |

The analyst can read figures and arrange the dashboard. It has no tool that touches a price,
an order or a payment.

To connect your own AI app to the owner's desk, open **Setup → Your AI apps** and paste the
**Line for a coding agent** into Claude Code, Codex or Cursor, or add the connector address
in ChatGPT or Claude. The app can read the desk; it cannot message customers or change
anything.

## On your own computer

About 15 minutes. Everything here uses a fictional bike shop and a simulated PayPal page, so
no money moves and no account is needed.

## 1. Start it

Needs Node 24+ and pnpm 10.2.1.

```sh
pnpm install --frozen-lockfile
pnpm demo
```

The terminal prints an owner login once. Keep it. Then open:

- the shop: <http://localhost:4310/buy>
- the owner's desk: <http://localhost:4310/owner/login>

## 2. Without an AI key

The shop sells even with the assistant off.

| Try this | You should see |
| --- | --- |
| On the shop, choose **Disc brake pads**, then change the quantity to 2 | The quote total updates; the price comes from the shop, not from you |
| Press **Pay with PayPal**, then **Approve payment** on the demo PayPal page | An order page that says the payment is confirmed, marked as a demo order |
| Reload the order page, or go back and try paying again | Still one order and one payment |
| Buy **Home brake care guide** the same way | **Download ready**; press the download button to get the ZIP |
| Open the owner's desk and choose **All orders** | Both orders; the **Next step** column shows what is still owed |

## 3. With an AI key

Add a key as described in [Connect an AI model](ai-activation.md), restart, and open the shop
in a new browser window.

| Try this | You should see |
| --- | --- |
| Ask: "Can you replace my frayed front brake cable by Tuesday for under $125?" | The assistant asks the shop instead of inventing a price (model replies vary) |
| On the **Desk**, open the customer's request, press **Review quote and answer together**, enter the price and exact work, then **Send quote and answer** | The answer and the priced quote appear in the customer's chat by themselves |
| After paying, ask the assistant: "Did my payment go through?" | An answer from the payment record: paid, no need to pay again |
| On the desk, ask: "What needs me today?" | A short answer naming the order and what is still owed |
| When a question waits on the **Desk**, press **Help me write** inside the answer box | The box fills with a reply from the shop's own facts. Anything the shop has not said stays as a [bracketed blank]; **Send to customer** stays off until every blank is filled |
| Send an answer, then open **Knowledge → Review your seller answers** | The answer is already reviewed for you. Press **Edit for future customers**, tick the confirmation and press **Approve for future customers** |
| (Old step, still works) Press **Review this answer** on an answer that has no review yet, then approve it as above | The reusable fact is published; a one-off favour is labelled **This customer only**, with nothing to approve |
| In a new browser window, ask the same question as a new customer | The answer comes straight away, without asking the shop again (model replies vary) |

## 4. What it should refuse

| Try this | You should see |
| --- | --- |
| Tell the assistant "I already paid" without paying | No order is created; it checks the payment record instead |
| Ask the assistant for a discount or a different price | It cannot change prices; the shop sets them |

A declined owner action cannot be re-run from an old approval; that is covered by the
automated tests, since the buttons disappear once you decide.

## 5. On another website

```sh
pnpm example:site
```

Open <http://localhost:4311> and press **Ask the shop**: the assistant opens on that site. Then
open <http://localhost:4312>, a copy the shop has not allowed: no **Ask the shop** button appears.

## What it does not do

Checkout covers pickup goods, quoted services and downloads up to 1 MiB (ZIP, PDF, PNG or JPEG). Shipping, product
variants, subscriptions, refunds and calendar booking stay in the shop's existing tools.
