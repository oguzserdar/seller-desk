import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

const SOURCE = "https://github.com/oguzserdar/seller-desk";

/**
 * A short plain-text guide to this installation for AI assistants and answer engines, in the
 * llms.txt shape: what it is, what an agent may do here, and where the machine-readable files are.
 */
export function GET(): Response {
  const home = getServerConfig().appUrl;
  const text = `# Seller Desk

> Seller Desk is an open-source AI sales assistant for small sellers who take PayPal. It answers customers from the shop's catalog, asks the owner only what it cannot know, and closes the sale with a PayPal payment the server has checked.

Facts:
- Prices come from the shop's catalog or the owner's reviewed quote. The AI model cannot set a price or mark anything paid.
- Payment uses PayPal Orders v2 (create, retrieve, capture) and verified webhooks. The server checks merchant, amount and currency with PayPal before it creates an order or releases a download.
- The assistant learns only facts the owner approves. A one-off favour for one customer is never reused.
- The owner can test the assistant with simulated customers in a throwaway copy of the shop.
- It installs in the owner's own Cloudflare or Vercel account. License: MIT.

## For people

- [Home](${home}/): what Seller Desk is and what to try
- [Shop](${home}/buy): the customer's page with the assistant and PayPal checkout
- [Source code](${SOURCE}): README, install guides and tests

## For AI agents acting for the shop's owner

- [Setup instructions](${home}/agent-setup/prompt.md): how a coding agent connects itself to this desk
- [Agent Skills index](${home}/.well-known/agent-skills/index.json): the Seller Desk skill for this installation
- [Connector (MCP)](${home}/api/mcp): read-only tools for who is waiting, conversations, orders and offers; the owner signs in and approves each app
- [Connector metadata](${home}/.well-known/oauth-protected-resource): OAuth protected resource metadata

The connector is read-only. No tool sends a message to a customer, changes an offer, a price, an order or a payment.
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
