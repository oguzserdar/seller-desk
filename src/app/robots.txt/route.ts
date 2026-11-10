import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * A real shop asks crawlers to stay out: its pages are per-buyer and the owner's desk is private.
 * A public demo of Seller Desk lets them read the home page and the files written for AI agents.
 */
export function GET(): Response {
  const config = getServerConfig();
  const lines = config.publicDemo
    ? ["User-agent: *", "Allow: /$", "Allow: /about/", "Allow: /llms.txt", "Allow: /.well-known/", "Allow: /agent-setup/", "Disallow: /owner", "Disallow: /api/", "Disallow: /checkout", "Disallow: /order", "Disallow: /quote", "Disallow: /buy", "", `Sitemap: ${config.appUrl}/sitemap.xml`]
    : ["User-agent: *", "Disallow: /"];
  return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
