# Test your assistant

Open **Knowledge → Test your assistant** in your desk. Write a fictional customer request and what you expect to happen. The expectation is for your review; the assistant never sees it.

A test uses your actual connected AI provider, your published catalog and shop knowledge, and the same chat handlers and tools as a customer conversation. There is no successful canned answer when a model is unavailable.

## Start small

Try a product question, an impossible deadline, an unavailable item or a request for a discount. Read the reply and the actions observed. A finished test means execution ended; it does not mean the answer was correct.

For a longer conversation, add up to three customer follow-ups. Add a seller reply when you want to test a handoff. A seller reply is a fictional action you supply, not an assistant answer.

To have a customer written for you, add **Simulated customer plays a part** and pick one of six preset customers: a haggler, someone who pastes fake system text, someone who wants more than you have, a firm budget, a buyer who writes in Spanish, or someone who wants custom work added before describing it. Your connected model writes their messages, from your published offers only, for one to three messages; they count toward the same three follow-ups and your daily AI limit. You choose a preset, not instructions, so a test cannot be steered.

Every test also ends with two checks read from the trial shop's records, whatever the conversation said: **Quoted at your published prices** (every fixed-price line matches its listing) and **Nothing beyond your stock is payable**.

## Check a purchase

Add **Customer pays the exact quote (fictional)**. Choose the published offer, quantity, currency and exact total. Confirm the displayed actor plan separately. The runner refuses a different product or price. The assistant cannot authorize its own payment.

For a custom service, add **Seller approves service scope** before the payment. Enter the scope and exact total; supply a unit price when the service needs a quote. Approval does not pay. The later fictional payer still approves the exact purchase.

The optional lost-response condition captures a fictional payment, loses its response and retries through the existing recovery engine. Check that there is one capture and one paid order. This is a local payment fault, not evidence of a real PayPal incident.

## Compare saved instructions

Choose a saved instruction version. The same actor plan runs sequentially against the published shop and a copy with that exact saved wording. Read both sides before publishing anything. This page never publishes an instruction or an answer.

## What is saved

The original shop keeps the request, expected outcome, explicit actor plan, source versions, actual transcript, observed tool states, independent database counts, checks and failure state. Reload or use **Refresh saved tests** after a lost connection. Retrying the same request cannot create another run. Starting a new test creates a new private report.

A trial's temporary commerce records live in a fresh isolated SQLite database. Node uses memory; Workers uses a separate SQLite Durable Object. They are discarded after execution; an expiry alarm removes an abandoned Worker trial. The durable report stays in your original PostgreSQL or D1 database.

No original stock, order, customer history, credential or purchased file is changed or copied into the trial. Digital downloads use a labeled fictional file. This does not verify real PayPal, your actual file delivery or native PostgreSQL execution inside a trial. Those need their separate integration checks.

Tests count toward the original shop's daily AI allowance. Only one run is active at a time, plans are bounded, and requests are rate limited. Provider errors remain failures. Read any partial result as partial evidence.
