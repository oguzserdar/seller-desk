import { Badge } from "@/components/arc/badge/badge";

const READS = ["An order as PayPal itself holds it", "Recent PayPal transactions", "Invoices", "Disputes and their status"];
const NEVER = ["Create or capture a payment", "Refund, cancel or change anything", "Decide that an order is paid"];

/**
 * The owner's optional second way to PayPal: PayPal's own Agent Toolkit, read-only, for the desk
 * assistant. It sits beside checkout and never replaces it.
 */
export function PayPalToolkit({ state }: { state: "on" | "off" | "needs-paypal" }) {
  return (
    <section id="paypal-tools" aria-labelledby="paypal-tools-heading" className="surface mt-8 scroll-mt-40 px-5 py-6 sm:scroll-mt-28 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="paypal-tools-heading" className="text-[22px] font-semibold">PayPal tools for your assistant</h2>
        <Badge tone={state === "on" ? "success" : "neutral"}>{state === "on" ? "On · read-only" : state === "needs-paypal" ? "Needs PayPal settings" : "Off"}</Badge>
      </div>
      <p className="text-ink-2 mt-2 max-w-[62ch] leading-relaxed">
        Your desk assistant can look things up in your PayPal account through PayPal&rsquo;s own Agent Toolkit. Ask it &ldquo;what does
        PayPal say about order 1006?&rdquo; or &ldquo;any open disputes?&rdquo;. Checkout does not use it: payments are created, checked and
        captured by this server&rsquo;s own code.
      </p>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-[14px] font-semibold">The assistant can read</h3>
          <ul className="text-ink-2 mt-2 grid gap-1.5 text-[14px]">{READS.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
        <div>
          <h3 className="text-[14px] font-semibold">It can never</h3>
          <ul className="text-ink-2 mt-2 grid gap-1.5 text-[14px]">{NEVER.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      </div>
      <p className="text-ink-3 mt-5 text-[13px] leading-relaxed">
        {state === "on"
          ? "Switched on in your host settings. Transaction lists need the Transaction Search permission on your PayPal app."
          : state === "needs-paypal"
            ? "Switched on, but waiting for your PayPal app settings above."
            : <>To switch it on, set <code className="font-mono">PAYPAL_AGENT_TOOLKIT=on</code> in your host settings and redeploy.</>}
      </p>
    </section>
  );
}
