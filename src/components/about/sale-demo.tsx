"use client";

/**
 * One sale, played once when it scrolls into view: the customer asks, the assistant asks the
 * shop, the owner prices it, the quote arrives, PayPal confirms, the desk shows what is owed.
 * It is an illustration of the product's flow, not a live shop. With reduced motion it shows
 * the finished sale without moving.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Check, Loader2, RotateCcw, Store, UserRound } from "lucide-react";

/** When each beat starts, in milliseconds from the first. */
const BEATS = [0, 900, 2100, 3300, 4500, 5300, 6900, 8200, 9100];
const LAST = BEATS.length - 1;

const rise = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.2, 0.7, 0.2, 1] as const },
};

export function SaleDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const seen = useInView(frame, { once: true, amount: 0.2 });
  const still = useReducedMotion() ?? false;
  const [beat, setBeat] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (still) {
      setBeat(LAST); // eslint-disable-line react-hooks/set-state-in-effect -- reduced motion shows the finished sale
      return;
    }
    setBeat(0);
    const timers = BEATS.slice(1).map((at, index) => window.setTimeout(() => setBeat(index + 1), at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [seen, still, run]);

  const replay = useCallback(() => setRun((count) => count + 1), []);
  const pay = beat >= 7 ? "paid" : beat >= 6 ? "checking" : "ready";

  return (
    <div ref={frame} className="sale-demo" role="img" aria-label="Illustration of one sale: a customer asks for a brake cable repair, the assistant asks the shop, the owner sends a $95 quote, the customer pays with PayPal, and the order appears on the owner's desk with its next step.">
      <div aria-hidden className="sale-demo-grid">
        <section className="sale-pane">
          <header className="sale-pane-head"><UserRound size={15} /> Customer, on the shop&rsquo;s page</header>
          <div className="sale-thread">
            <p className="sale-bubble sale-bubble-me">Can you replace my brake cable by Tuesday, for under $125?</p>
            <AnimatePresence initial={false}>
              {beat >= 1 ? (
                <motion.div key="ask" {...rise} className="sale-answer">
                  <p>That is a custom repair, so I won&rsquo;t guess a price. I&rsquo;ve asked the shop.</p>
                  <span className="sale-chip" data-done={beat >= 5 || undefined}>
                    {beat >= 5 ? <Check size={13} /> : <Loader2 size={13} className="sale-spin" />}
                    {beat >= 5 ? "The shop answered" : "Waiting for the shop"}
                  </span>
                </motion.div>
              ) : null}
              {beat >= 5 ? (
                <motion.div key="quote" {...rise} className="sale-quote">
                  <div className="sale-quote-line"><span>Brake cable replacement</span><span className="tabular">$95.00</span></div>
                  <p className="sale-quote-note">Front cable replaced, brakes tested. Ready Tuesday.</p>
                  <div className="sale-quote-total"><span>Total</span><span className="tabular">$95.00</span></div>
                  <span className="sale-pay" data-state={pay}>
                    <span data-on={pay === "ready" || undefined}>Pay with PayPal</span>
                    <span data-on={pay === "checking" || undefined}><Loader2 size={15} className="sale-spin" /> Checking with PayPal</span>
                    <span data-on={pay === "paid" || undefined}><Check size={16} /> Paid. Order #1004</span>
                  </span>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>

        <section className="sale-pane sale-pane-desk">
          <header className="sale-pane-head"><Store size={15} /> Owner, on the desk</header>
          <div className="sale-desk">
            <AnimatePresence initial={false}>
              {beat >= 2 ? (
                <motion.div key="needs" {...rise} className="sale-card">
                  <span className="sale-tag" data-done={beat >= 4 || undefined}>{beat >= 4 ? "Answered" : "Needs you"}</span>
                  <p className="sale-card-title">Brake cable replaced by Tuesday, under $125?</p>
                  <div className="sale-field">
                    <span>Your price</span>
                    <span className="sale-field-value tabular" data-on={beat >= 3 || undefined}>$95.00</span>
                  </div>
                  <span className="sale-send" data-done={beat >= 4 || undefined}>
                    {beat >= 4 ? <><Check size={15} /> Quote sent</> : "Send quote and answer"}
                  </span>
                </motion.div>
              ) : null}
              {beat >= 8 ? (
                <motion.div key="order" {...rise} className="sale-order">
                  <span className="sale-order-number tabular">#1004</span>
                  <span className="sale-order-main">
                    <span>Brake cable replacement</span>
                    <span className="sale-order-next">Paid. Next: confirm a time</span>
                  </span>
                  <span className="tabular">$95.00</span>
                </motion.div>
              ) : null}
            </AnimatePresence>
            {beat < 2 ? <p className="sale-quiet">Nothing needs you right now.</p> : null}
          </div>
        </section>
      </div>
      <button type="button" className="sale-replay" onClick={replay} aria-label="Play the illustration again">
        <RotateCcw aria-hidden size={14} /> Replay
      </button>
    </div>
  );
}
