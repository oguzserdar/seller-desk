/**
 * A stand-in for a merchant's own website, to test the widget on another origin.
 *
 *   pnpm example:site [--desk http://localhost:4310]
 *
 * Port 4311 is in the demo shop's allowed origins, so the shop opens there.
 * Port 4312 is not, so the browser refuses to show the shop inside it.
 */
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { desk: { type: "string", default: "http://localhost:4310" } } });
const desk = values.desk.replace(/\/$/, "");

function page(port: number, allowed: boolean): string {
  const note = allowed
    ? ""
    : `<p class="note">This copy runs on port ${port}, which the shop owner has not allowed. The shop refuses to open inside it.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spoke Street Cycles</title>
<style>
  body { margin: 0; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #f4f5f2; }
  header, main, footer { max-width: 960px; margin: 0 auto; padding: 0 24px; }
  header { display: flex; justify-content: space-between; align-items: center; height: 72px; }
  header strong { font-size: 19px; }
  nav a { margin-left: 20px; color: #1f2328; text-decoration: none; }
  .hero { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; padding: 40px 0 64px; }
  .hero img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: #e9ebee; }
  h1 { font-size: 44px; line-height: 1.1; margin: 0 0 16px; letter-spacing: -0.02em; }
  .hours { border-top: 1px solid #d9dcd5; padding: 24px 0 96px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
  .note { margin: 0 auto 24px; max-width: 912px; padding: 12px 16px; background: #fff3e0; border-radius: 6px; font-size: 15px; }
  @media (max-width: 700px) { .hero, .hours { grid-template-columns: 1fr; } h1 { font-size: 34px; } nav { display: none; } }
</style>
</head>
<body>
${note}
<header><strong>Spoke Street Cycles</strong><nav><a href="#">Parts</a><a href="#">Repairs</a><a href="#">Visit</a></nav></header>
<main>
  <section class="hero">
    <div>
      <h1>Parts, repairs and honest quotes.</h1>
      <p>A bike shop and repair bench on Mill Road. Ask the shop what you need; it answers from our real stock and prices, and you pay with PayPal.</p>
    </div>
    <img src="${desk}/shop/front-light.webp" alt="A rechargeable bike front light">
  </section>
  <section class="hours">
    <div><strong>Shop</strong><br>88 Mill Road<br>Tuesday to Saturday, 10:00 to 17:00</div>
    <div><strong>Repair bench</strong><br>Brake checks and services by appointment</div>
  </section>
</main>
<script src="${desk}/widget.js" async></script>
</body>
</html>`;
}

for (const [port, allowed] of [
  [4311, true],
  [4312, false],
] as const) {
  createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(page(port, allowed));
  }).listen(port, "localhost", () => console.log(`example site on http://localhost:${port} (${allowed ? "allowed" : "not allowed"} to show the shop)`));
}
