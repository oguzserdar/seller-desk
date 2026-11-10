import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

/** One address on a public demo, the home page. A real shop lists nothing. */
export function GET(): Response {
  const config = getServerConfig();
  const entries = config.publicDemo ? `  <url><loc>${config.appUrl}/</loc><changefreq>weekly</changefreq></url>\n` : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}</urlset>\n`, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
