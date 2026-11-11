import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Instrument_Serif } from "next/font/google";
import { ArrowRight, Check, Lock } from "lucide-react";
import { AgentDemo } from "./agent-demo";
import { PixelField } from "./pixel-field";
import { SaleDemo } from "./sale-demo";
import { RefusedDemo } from "./refused-demo";
import { getSeller } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";
import "./about.css";

const TITLE = "Seller Desk: the open-source AI sales assistant for PayPal sellers";
const DESCRIPTION = "Seller Desk answers customers from your catalog, asks you only what it cannot know, and closes the sale with a PayPal payment the server has checked. Open source, MIT licensed.";

/**
 * Page metadata for the Seller Desk home page.
 *
 * @param indexable - Whether search engines may index it; only a public demo says yes
 * @returns Title, description, canonical address and share cards
 */
export function homeMetadata(indexable: boolean): Metadata {
  const home = getServerConfig().appUrl;
  return {
    metadataBase: new URL(home),
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: "/" },
    robots: { index: indexable, follow: indexable },
    openGraph: { type: "website", url: "/", siteName: "Seller Desk", title: TITLE, description: DESCRIPTION, images: [{ url: "/about/share.png", width: 1200, height: 630, alt: "Seller Desk: one sale from a customer's question to a checked PayPal payment" }] },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/about/share.png"] },
  };
}

// The headline's face: a high-contrast serif, set large against the field of squares. Loaded only here.
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

const SOURCE = "https://github.com/oguzserdar/seller-desk";
const TEST_GUIDE = `${SOURCE}/blob/main/docs/how-to-test.md`;

// Each row of cards keeps its three texts the same length, so they wrap to the same number of lines.
const STEPS = [
  { title: "Ask the shop", body: "Ask for a gift under $100 or a brake cable repair. It answers from the catalog and asks the owner the rest." },
  { title: "Pay in the PayPal sandbox", body: "Add disc brake pads and press Pay with PayPal. The server checks the payment before any order exists." },
  { title: "See it on the owner's desk", body: "Open the desk, no login needed. The order is there with its next step, beside the customer who waits." },
];

// Plain answers to what people and answer engines ask first. The same text feeds the structured data.
const QUESTIONS = [
  { q: "What is Seller Desk?", a: "An open-source AI sales assistant for small sellers who take PayPal. It answers customers from the shop's catalog, asks the owner when it cannot know, builds a quote and takes payment through PayPal checkout." },
  { q: "Can the AI change a price or mark something paid?", a: "No. Prices come from the shop's catalog or the owner's reviewed quote, and payment status comes from PayPal. The server checks the merchant, amount and currency with PayPal before it creates an order or releases a download." },
  { q: "Which PayPal APIs does it use?", a: "PayPal Orders v2 to create, retrieve and capture the payment, and verified webhooks as a backup. The owner's desk assistant can also read orders, transactions, invoices and disputes through PayPal's own Agent Toolkit. The hosted demo runs in the PayPal sandbox, so no real money moves." },
  { q: "Why not let the AI call PayPal to take the payment?", a: "Because a model that can create or capture a payment decides money. Seller Desk uses PayPal's Agent Toolkit for reading and its own server code for checkout, where the amount comes from a saved quote and the merchant, amount and currency are checked before an order exists." },
  { q: "Which AI models does it work with?", a: "It uses the Vercel AI SDK, so the owner chooses: Anthropic, OpenAI, Google, OpenRouter or Vercel AI Gateway. Without an AI key the shop still sells as a plain catalog with PayPal checkout." },
  { q: "Can my own AI app work with my shop?", a: "Yes. Each installation is a connector (MCP) and an Agent Skill. Claude, ChatGPT, Codex or Cursor can read who is waiting, conversations, orders and offers. The connector is read-only: it cannot message customers, change prices or move money." },
  { q: "How do I run my own copy?", a: "It installs in your own Cloudflare or Vercel account with your own PayPal account and AI key, or runs locally with one command. The source is MIT licensed." },
];

// Five ways someone tries to move money by talking, and the same ending each time.
const TESTS = [
  { who: "A haggler", result: "Kept the published price" },
  { who: "Pasted fake system text", result: "Refused, no price change" },
];

/** What Seller Desk is and what to try, for someone who opens a public demo. */
export async function SellerDeskHome() {
  const shop = await getSeller();
  const home = getServerConfig().appUrl;
  // Structured data for search and answer engines; every value is also visible on the page.
  const data = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Seller Desk", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: DESCRIPTION, url: home, license: "https://opensource.org/license/mit", isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, codeRepository: SOURCE },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: QUESTIONS.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  return (
    <div className={`about ${serif.variable} bg-canvas text-ink flex min-h-dvh flex-col`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />
      <header className="about-hero">
        <PixelField />
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <p className="font-display text-[20px] font-semibold tracking-[-0.02em]">Seller Desk</p>
          <nav aria-label="Seller Desk" className="about-nav flex items-center gap-5 text-[14px] font-medium">
            <a href={SOURCE}>Source</a>
            <Link href="/owner/login">Owner sign in</Link>
          </nav>
        </div>

        <div className="about-hero-stage">
          <p className="about-eyebrow">Open source · PayPal checkout · AI assistant</p>
          <h1 className="about-headline">The sales team a small seller <em>never had</em></h1>
          <p className="about-lede">
            Seller Desk answers customers from your catalog, asks you only what it cannot know, and
            closes the sale with a PayPal payment the server has checked.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/buy" className="about-cta about-cta-primary">Try the demo shop <ArrowRight aria-hidden size={18} /></Link>
            <form method="post" action="/owner/demo"><button type="submit" className="about-cta about-cta-quiet">Look around the owner&rsquo;s desk</button></form>
          </div>
          <p className="about-fine">
            {shop ? `${shop.displayName} is a fictional shop. ` : ""}Payments run in the PayPal sandbox, so no real money moves.
          </p>
        </div>
      </header>

      <main className="flex flex-col">
        <section aria-labelledby="sale" className="about-lift mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <h2 id="sale" className="sr-only">One sale, start to finish</h2>
          <SaleDemo />
          <p className="text-ink-3 mt-3 text-center text-[13px]">One sale, start to finish. An illustration of the flow you can try in the demo shop.</p>
        </section>

        <section aria-labelledby="try" className="about-section mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <h2 id="try" className="about-h2 font-display">Try it in two minutes</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="about-step">
                <span aria-hidden className="about-step-number tabular">{index + 1}</span>
                <h3 className="mt-4 text-[18px] font-semibold">{step.title}</h3>
                <p className="text-ink-2 mt-2 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="judges" className="mx-auto mt-10 w-full max-w-[1180px] px-4 sm:px-6">
          <div className="about-judges">
            <div>
              <h2 id="judges" className="about-judges-title">Judging this entry?</h2>
              <p className="text-ink-2 mt-1.5 max-w-[60ch] leading-relaxed">
                Anyone can look around the desk without changing it. To answer a customer or send a
                quote, sign in: the owner&rsquo;s email and password are in the submission&rsquo;s testing
                instructions, with a PayPal sandbox buyer.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/owner/login" className="about-judges-link about-judges-link-main">Owner&rsquo;s desk sign in</Link>
              <a href={TEST_GUIDE} className="about-judges-link">Step-by-step test guide</a>
            </div>
          </div>
        </section>

        <section aria-labelledby="different" className="about-section mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <h2 id="different" className="about-h2 font-display">What is different</h2>
          <ul className="mt-8 grid gap-4 lg:grid-cols-3">
            <li className="about-tile">
              <div aria-hidden className="about-art">
                <p className="sale-bubble sale-bubble-me">I already paid, send my download.</p>
                <p className="about-art-reply"><Lock size={14} /> No payment is on record for this quote.</p>
              </div>
              <h3>The model never decides money</h3>
              <p>Prices, totals and payment status are server records checked against PayPal. Paying twice makes one order.</p>
            </li>
            <li className="about-tile">
              <div aria-hidden className="about-art">
                <p className="about-art-row"><span>The side entrance is step-free.</span><em data-kind="fact"><Check size={12} /> Fact, approved</em></p>
                <p className="about-art-row"><span>Isabel can pick up until 18:00 on Friday.</span><em>One-off, stays private</em></p>
              </div>
              <h3>It learns only what you approve</h3>
              <p>Each answer is split into a fact for every customer and a favour for one. Only approved facts are used again.</p>
            </li>
            <li className="about-tile">
              <div aria-hidden className="about-art">
                {TESTS.map((test) => (
                  <p key={test.who} className="about-art-row"><span>{test.who}</span><em data-kind="fact"><Check size={12} /> {test.result}</em></p>
                ))}
              </div>
              <h3>The owner can test it first</h3>
              <p>Simulated customers talk to the real assistant in a throwaway copy of the shop. Every quote is checked.</p>
            </li>
          </ul>
        </section>

        <section aria-labelledby="agent" className="about-dark">
          <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="about-eyebrow">Agentic commerce, with limits</p>
              <h2 id="agent" className="about-h2 font-display mt-2">Your own AI can work the desk</h2>
              <p className="about-dark-text mt-4 max-w-[46ch]">
                Paste one line into Claude Code, Codex or Cursor, or add the connector in ChatGPT or
                Claude. It reads who is waiting, conversations, orders and offers.
              </p>
              <p className="about-dark-text mt-3 max-w-[46ch]">The connector is read-only. It cannot message customers, change prices or move money.</p>
            </div>
            <AgentDemo />
          </div>
        </section>

        <section aria-labelledby="desk" className="about-section mx-auto grid w-full max-w-[1180px] gap-10 px-4 sm:px-6 lg:grid-cols-[6fr_5fr] lg:items-center">
          <Image
            src="/about/desk.webp"
            alt="The owner's desk: paid orders, and the customer questions waiting for the owner"
            width={1440}
            height={1000}
            sizes="(min-width: 1024px) 600px, 92vw"
            className="about-shot"
          />
          <div>
            <h2 id="desk" className="about-h2 font-display">One desk for what is owed</h2>
            <p className="text-ink-2 mt-4 max-w-[46ch] leading-relaxed">
              Paid is not done. Every order shows its next step: confirm a time, hand over at pickup,
              finish the work. Questions the assistant could not answer wait in the same place.
            </p>
            <p className="text-ink-2 mt-3 max-w-[46ch] leading-relaxed">
              A WordPress plugin or one script tag puts the assistant on the website a seller already has.
            </p>
          </div>
        </section>

        <section aria-labelledby="insights" className="about-section mx-auto grid w-full max-w-[1180px] gap-10 px-4 sm:px-6 lg:grid-cols-[5fr_6fr] lg:items-center">
          <div>
            <h2 id="insights" className="about-h2 font-display">Ask your own numbers</h2>
            <p className="text-ink-2 mt-4 max-w-[46ch] leading-relaxed">
              Insights puts sales, conversations and stock on one dashboard, built on AG Studio. Tap a bar to see that
              product&apos;s orders. Ask the analyst how the shop is doing and it reads the shop&apos;s own figures, or asks
              Studio&apos;s agents to add a chart.
            </p>
            <p className="text-ink-2 mt-3 max-w-[46ch] leading-relaxed">
              It reads and arranges. It has no tool that touches a price, an order or a payment, and it shows what it did.
            </p>
            <Link href="/owner/insights" className="text-ink mt-4 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4">
              Open Insights
            </Link>
          </div>
          <Image
            src="/about/insights.webp"
            alt="Insights: revenue through PayPal, revenue by product, and the orders still owing work"
            width={1440}
            height={1000}
            sizes="(min-width: 1024px) 640px, 92vw"
            className="about-shot"
          />
        </section>

        <section aria-labelledby="refused" className="about-section mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <h2 id="refused" className="about-h2 font-display">The AI talks. The server decides money.</h2>
          <RefusedDemo />
        </section>

        <section aria-labelledby="questions" className="about-section mx-auto w-full max-w-[1180px] px-4 sm:px-6">
          <h2 id="questions" className="about-h2 font-display">Questions</h2>
          <dl className="about-questions">
            {QUESTIONS.map(({ q, a }) => (
              <div key={q}>
                <dt>{q}</dt>
                <dd>{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="start" className="about-close">
          <h2 id="start" className="about-h2 font-display">Open the shop and ask it something</h2>
          <p className="about-dark-text mx-auto mt-3 max-w-[52ch]">
            It installs in your own Cloudflare or Vercel account, with your own PayPal account and your own AI key. MIT licensed.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/buy" className="about-cta about-cta-primary">Try the demo shop <ArrowRight aria-hidden size={18} /></Link>
            <a href={SOURCE} className="about-cta about-cta-quiet">Source and install guide</a>
          </div>
        </section>
      </main>

      <footer className="about-foot">
        Seller Desk is open source under the MIT license. Checkout uses PayPal Orders and verified webhooks.
      </footer>
    </div>
  );
}
