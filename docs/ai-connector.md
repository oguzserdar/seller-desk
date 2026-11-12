# AI connector (MCP)

Owners connect Seller Desk to their own ChatGPT, Claude, Claude Code or Codex. The AI reads the desk
and drafts; nothing reaches a buyer until the owner sends it from Seller Desk.

## What it is

One HTTPS endpoint, `/api/mcp`, speaking the Model Context Protocol (streamable HTTP, stateless). The
owner pastes its address into the AI app once; Seller Desk shows its sign-in, then a consent page that
names the AI app and what it may do. The AI gets a short-lived token bound to this endpoint. The owner
can remove an AI app from Setup at any time. Whether a connected app may answer a customer's waiting question as the owner is set under Setup → Who answers (off until the owner turns it on); every answer it sends is drafted as shop knowledge for the owner to approve, like an answer typed on the desk.

## Groundings

1. **This repository.** Better Auth 1.7.7 owns owner sign-in (`src/server/auth/auth.ts`) on PostgreSQL
   and on D1. Owner-only mutations already check the owner and a revision (`src/server/domain/shop-guide.ts`,
   `src/server/domain/seller-questions.ts`), and tools enforce permission inside execution, not in
   observers (`docs/conversation-ownership.md`).
2. **Vendor documentation.** Intercom's MCP server (developers.intercom.com/docs/guides/mcp, read 23 Oct):
   OAuth with a consent page naming the app; supports Claude Desktop, Claude Code, Claude.ai, OpenAI,
   Cursor; reads conversations and contacts; its only conversation write is an internal note. MCP
   authorization spec 2025-11-25 and OpenAI Apps SDK auth (PKCE S256, `resource` parameter, RFC 9728
   discovery, RFC 9207 `iss`).
3. **How it fails elsewhere.** Zendesk announced a general MCP server in May 2026 that had not shipped
   by September; every server reading Zendesk tickets was third-party (tldv.io/blog/zendesk-mcp). The
   lesson for us: ship read and draft tools first, keep buyer-facing sends behind the owner.
4. **Pinned versions.** `better-auth`, `@better-auth/mcp` and `@better-auth/oauth-provider` are all
   1.7.7; `@modelcontextprotocol/server` is 2.3.1. Client ID Metadata Documents are not offered:
   `@better-auth/cimd`'s safe fetcher needs Node's DNS pinning (`node:https`, `node:net`), which Workers
   lack, and ChatGPT, Claude and Codex all register dynamically instead. 1.7.7 also has no
   `clientRegistrationDefaultApplicationType: "infer"`, so `inferNativeClient` registers loopback-only
   clients (Claude Code, Codex, Cursor) as native; a unit test fails once the installed version has it.

## Scope, first version

| Tool | Kind | What it does |
|---|---|---|
| `list_waiting` | read | Buyers and questions waiting for the owner, oldest first |
| `read_conversation` | read | One conversation, messages and current quote |
| `list_orders` | read | Recent orders and their state |
| `list_offers` | read | The shop's offers, prices and stock |
| `list_conversations` | read | The 50 most recent conversations and who is handling each |
| `draft_answer` | draft, **not built yet** | Saves a suggested answer to a waiting question; the owner sends or edits it in Seller Desk |

No tool sends a message, changes a price, refunds or approves anything. The server enforces that, not
the AI's instructions.

## 24/7

MCP only runs when the AI calls in; no AI app can be woken by Seller Desk. Round-the-clock buyer
answers stay with Seller Desk's own assistant (the shop's AI key). The connector is for the owner to
review, ask and draft from the AI app they already use.

## How it fits together

| Piece | File |
|---|---|
| Authorization server plugins, desktop-app registration | `src/server/auth/connector.ts` |
| OAuth tables | `drizzle/20261024025425_ai_connector.sql`, `drizzle-d1/0004_ai_connector.sql` |
| Discovery at the site root | `src/app/.well-known/*`, `src/server/connector/discovery.ts` |
| Sign-in resumes the app's request | `src/lib/connector-resume.ts`, `src/app/owner/login/*` |
| Consent page (Allow / Deny) | `src/app/owner/connect/*`, `src/server/connector/consent.ts` |
| MCP endpoint | `src/app/api/mcp/route.ts`, `src/server/connector/tools.ts` |
| Allowed apps, Remove, per-call check | `src/server/connector/access.ts`, Setup → AI apps |

The endpoint reads the signing keys from Better Auth in process, not from its own `/jwks` URL: a
Worker that requests its own hostname does not reach itself. The consent answer goes through Better
Auth's handler as a real request, because the consent step continues the authorization request and a
direct `auth.api` call carries none.

## Build order

1. Done: auth server (`jwt`, `mcp`), OAuth tables in both databases, sign-in resume, consent page.
2. Done: `/api/mcp` with five read tools. Next: `draft_answer` and its review in the desk.
3. Done: Setup → AI apps lists connected apps with Remove.
4. Done: end-to-end test on a Miniflare D1 runtime (`tests/integration/ai-connector.test.ts`).
   Next: a live connection from Claude Code and ChatGPT against a preview deployment.
