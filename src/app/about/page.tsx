import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, FlaskConical, ShieldCheck } from "lucide-react";
import { getSeller } from "@/server/domain/seller";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About",
  description: "Seller Desk is an open-source AI sales assistant for small sellers who take PayPal.",
};

const SOURCE = "https://github.com/oguzserdar/seller-desk";

const STEPS = [
  {
    title: "Ask the shop",
    body: "Open the demo shop and ask for a gift under $100, or for a brake cable replaced by Tuesday. The assistant answers from the catalog and asks the owner what it cannot know.",
  },
  {
    title: "Pay in the PayPal sandbox",
    body: "Add disc brake pads and press Pay with PayPal. The server checks the payment with PayPal before any order exists. No real money moves.",
  },
  {
    title: "See it on the owner's desk",
    body: "Sign in to the desk. The order is there with its next step, and so is the customer who is waiting for a price.",
  },
];

const DIFFERENT = [
  {
    icon: ShieldCheck,
    title: "The model never decides money",
    body: "Prices, totals and payment status are server records checked against PayPal. Saying “I already paid” does nothing. Paying twice still ends in one order.",
  },
  {
    icon: BadgeCheck,
    title: "It learns only what the owner approves",
    body: "An answer is split into a fact every customer should know and a favour for one customer. Only approved facts are used again.",
  },
  {
    icon: FlaskConical,
    title: "The owner can test it first",
    body: "Simulated customers talk to the real assistant in a throwaway copy of the shop. Every quote is checked against real prices and stock.",
  },
];

/** What Seller Desk is and what to try, for someone who opens a public demo. */
export default async function AboutPage() {
  const shop = await getSeller();
  return (
    <div className="bg-canvas text-ink flex min-h-dvh flex-col">
      <header className="bg-band text-band-ink">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <p className="font-display text-[20px] font-semibold tracking-[-0.02em]">Seller Desk</p>
          <nav aria-label="Seller Desk" className="text-band-ink-2 flex items-center gap-5 text-[14px] font-medium">
            <a href={SOURCE} className="hover:text-band-ink">Source</a>
            <Link href="/owner/login" className="hover:text-band-ink">Owner sign in</Link>
          </nav>
        </div>
        <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-4 pt-10 pb-14 sm:px-6 sm:pt-14 sm:pb-20 lg:grid-cols-[11fr_12fr] lg:items-center">
          <div>
            <p className="text-band-ink-2 text-[14px] font-medium">Open source · PayPal checkout · AI assistant</p>
            <h1 className="font-display mt-3 max-w-[14ch] text-[38px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[54px]">
              The sales team a small seller never had.
            </h1>
            <p className="text-band-ink-2 mt-5 max-w-[46ch] text-[17px] leading-relaxed sm:text-[18px]">
              Seller Desk answers customers from your catalog, asks you only what it cannot know, and
              closes the sale with a PayPal payment the server has checked.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/buy" className="about-cta about-cta-primary">
                Try the demo shop <ArrowRight aria-hidden size={18} />
              </Link>
              <Link href="/owner/login" className="about-cta about-cta-quiet">Open the owner&rsquo;s desk</Link>
            </div>
            <p className="text-band-ink-2 mt-4 max-w-[46ch] text-[14px]">
              {shop ? `${shop.displayName} is a fictional shop. ` : ""}Payments run in the PayPal sandbox, so no real money moves.
            </p>
          </div>
          <Image
            src="/about/quote.webp"
            alt="The demo shop: products on the left, and a customer's quote for brake pads with the total and the Pay with PayPal button"
            width={1440}
            height={1000}
            sizes="(min-width: 1024px) 600px, 92vw"
            priority
            className="border-band-line h-auto w-full rounded-[14px] border shadow-[0_24px_60px_rgb(0_0_0/0.35)]"
          />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-16 px-4 py-14 sm:px-6 sm:py-20">
        <section aria-labelledby="try">
          <h2 id="try" className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em]">Try it in two minutes</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span aria-hidden className="bg-brand-soft text-brand tabular flex size-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold">{index + 1}</span>
                <div>
                  <h3 className="text-[17px] font-semibold">{step.title}</h3>
                  <p className="text-ink-2 mt-1 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="different">
          <h2 id="different" className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em]">What is different</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {DIFFERENT.map(({ icon: Icon, title, body }) => (
              <li key={title} className="border-line bg-surface rounded-[14px] border p-5">
                <Icon aria-hidden size={22} strokeWidth={1.75} className="text-brand" />
                <h3 className="mt-3 text-[17px] font-semibold">{title}</h3>
                <p className="text-ink-2 mt-2 leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="desk" className="grid gap-8 lg:grid-cols-[6fr_5fr] lg:items-center">
          <Image
            src="/about/desk.webp"
            alt="The owner's desk: orders with the next step each one needs"
            width={1440}
            height={1000}
            sizes="(min-width: 1024px) 560px, 92vw"
            className="border-line h-auto w-full rounded-[14px] border"
          />
          <div>
            <h2 id="desk" className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em]">Your own AI can work the desk</h2>
            <p className="text-ink-2 mt-4 max-w-[48ch] leading-relaxed">
              Paste one line into Claude Code, Codex or Cursor, or add the connector in ChatGPT or
              Claude. Then ask &ldquo;What needs me today?&rdquo; and it answers from the order records.
            </p>
            <p className="text-ink-2 mt-3 max-w-[48ch] leading-relaxed">
              It can read who is waiting, orders and offers, and draft answers. It can never message
              customers, change prices or move money.
            </p>
          </div>
        </section>

        <section aria-labelledby="install" className="border-line bg-surface rounded-[14px] border p-6 sm:p-8">
          <h2 id="install" className="font-display text-[24px] leading-tight font-semibold tracking-[-0.02em]">Runs on the shop you already have</h2>
          <p className="text-ink-2 mt-3 max-w-[64ch] leading-relaxed">
            A WordPress plugin or one script tag puts the assistant on an existing website. It installs
            in your own Cloudflare or Vercel account, with your own PayPal account and your own AI key.
            MIT licensed.
          </p>
          <a href={SOURCE} className="text-brand mt-4 inline-flex items-center gap-1.5 font-semibold hover:underline">
            Source, install guide and how to test <ArrowRight aria-hidden size={16} />
          </a>
        </section>
      </main>

      <footer className="border-line text-ink-3 border-t px-4 py-6 text-center text-[13px]">
        Seller Desk is open source under the MIT license. Checkout uses PayPal Orders and verified webhooks.
      </footer>
    </div>
  );
}
