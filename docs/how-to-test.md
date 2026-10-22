# How to test Seller Desk

About 15 minutes on your own computer. Everything here uses a fictional bike shop and a
simulated PayPal page, so no money moves and no account is needed.

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
| Open **Knowledge → Review your seller answers**, press **Review this answer**, then **Edit for future customers**, tick the confirmation and press **Approve for future customers** | The reusable fact is published; a one-off favour is labelled **This customer only**, with nothing to approve |
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
