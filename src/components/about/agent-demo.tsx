"use client";

/** The owner's own AI app asking the desk a question. Lines arrive once, when the block is seen. */
import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";

const LINES = [
  { kind: "ask", text: "What needs me today?" },
  { kind: "tool", text: "Seller Desk · read who is waiting, orders" },
  { kind: "say", text: "Two things need you:" },
  { kind: "item", text: "A customer is waiting for a price on a brake cable repair." },
  { kind: "item", text: "Order #1001, disc brake pads, is paid and ready for pickup." },
  { kind: "say", text: "I drafted a reply for the first one. Nothing was sent." },
] as const;

export function AgentDemo() {
  const block = useRef<HTMLDivElement>(null);
  const seen = useInView(block, { once: true, amount: 0.5 });
  const still = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (still) {
      setShown(LINES.length); // eslint-disable-line react-hooks/set-state-in-effect -- reduced motion shows every line
      return;
    }
    const timers = LINES.map((_, index) => window.setTimeout(() => setShown(index + 1), 500 + index * 750));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [seen, still]);

  return (
    <div ref={block} className="agent-demo" role="img" aria-label="Illustration: the owner asks their own AI app what needs them today, and it answers from the desk's records without sending anything.">
      <div aria-hidden className="agent-demo-bar"><span /><span /><span /><em>your AI app</em></div>
      <div aria-hidden className="agent-demo-body">
        {LINES.map((line, index) => (
          <p key={line.text} className="agent-line" data-kind={line.kind} data-on={index < shown || undefined}>{line.text}</p>
        ))}
      </div>
    </div>
  );
}
