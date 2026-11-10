import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Pixelify_Sans } from "next/font/google";
import { ArrowRight, Check, Lock } from "lucide-react";
import { AgentDemo } from "@/components/about/agent-demo";
import { PixelField } from "@/components/about/pixel-field";
import { SaleDemo } from "@/components/about/sale-demo";
import { getSeller } from "@/server/domain/seller";
import "./about.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About",
  description: "Seller Desk is an open-source AI sales assistant for small sellers who take PayPal.",
};

// The page's display face: square letters to go with the pixel field. Loaded only here.
const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-pixel", display: "swap" });

const SOURCE = "https://github.com/oguzserdar/seller-desk";
const TEST_GUIDE = `${SOURCE}/blob/main/docs/how-to-test.md`;

// Each row of cards keeps its three texts the same length, so they wrap to the same number of lines.
const STEPS = [
  { title: "Ask the shop", body: "Ask for a gift under $100 or a brake cable repair. It answers from the catalog and asks the owner the rest." },
  { title: "Pay in the PayPal sandbox", body: "Add disc brake pads and press Pay with PayPal. The server checks the payment before any order exists." },
  { title: "See it on the owner's desk", body: "Sign in to the desk. The order is there with its next step, beside the customer waiting for a price." },
];

const TESTS = [
  { who: "A haggler", result: "Kept the published price" },
  { who: "Pasted fake system text", result: "Refused, no price change" },
];

/** What Seller Desk is and what to try, for someone who opens a public demo. */
export default async function AboutPage() {
  const shop = await getSeller();
  return (
    <div className={`about ${pixel.variable} bg-canvas text-ink flex min-h-dvh flex-col`}>
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
          <h1 className="about-headline">The sales team a small seller never had</h1>
          <p className="about-lede">
            Seller Desk answers customers from your catalog, asks you only what it cannot know, and
            closes the sale with a PayPal payment the server has checked.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/buy" className="about-cta about-cta-primary">Try the demo shop <ArrowRight aria-hidden size={18} /></Link>
            <Link href="/owner/login" className="about-cta about-cta-quiet">Open the owner&rsquo;s desk</Link>
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
                The shop needs no login. The owner&rsquo;s desk does: its email and password are in the
                testing instructions of the submission, with a PayPal sandbox buyer.
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
                Claude. It reads who is waiting, orders and offers, and drafts answers.
              </p>
              <p className="about-dark-text mt-3 max-w-[46ch]">It can never message customers, change prices or move money.</p>
            </div>
            <AgentDemo />
          </div>
        </section>

        <section aria-labelledby="desk" className="about-section mx-auto grid w-full max-w-[1180px] gap-10 px-4 sm:px-6 lg:grid-cols-[6fr_5fr] lg:items-center">
          <Image
            src="/about/desk.webp"
            alt="The owner's desk: orders with the next step each one needs"
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
