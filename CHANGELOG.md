# Changelog

All notable changes to Seller Desk. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 (12 Nov 2026)

First public release, made for the PayPal AI Hackathon.

### Customers
- A shop assistant that answers from the shop's real catalog, prices, stock and terms, and never sets a price or marks anything paid.
- Custom work goes to the owner for a price; the customer gets the quote in the same chat.
- PayPal checkout (Orders v2): the server creates and captures the order and checks PayPal's record (status, amount, currency, payee) before any order exists. A quote can be paid once; buying again makes a new quote.
- The chat survives closing the tab, on the same device.

### Owners
- The desk: what needs you, paid orders, work still owed.
- Help me write: drafts the reply from the shop's own facts and leaves [[blanks]] for anything the shop has not said; a reply with a blank left cannot be sent.
- Every answer is drafted as shop knowledge; approve it once and the assistant answers the next customer itself.
- Who answers: only the owner, or the assistant drafts and the owner approves; connected AI apps (Claude, ChatGPT) can answer waiting questions when the owner turns that on.
- Insights built with AG Grid's AG Studio agents.
- A read-only PayPal Agent Toolkit view, and an MCP connector with OAuth for the owner's own AI app.

### Hosting
- Cloudflare Workers with D1, or Node with PostgreSQL. MIT licensed.
