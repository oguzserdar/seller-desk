import { Check, Clock, Minus, TriangleAlert, X } from "lucide-react";
import { cx } from "@/lib/cx";
import type { PurchaseStep, PurchaseStepState } from "@/lib/purchase-steps";

const DOT: Record<PurchaseStepState, { icon: typeof Check; className: string; spoken: string }> = {
  done: { icon: Check, className: "bg-success-soft text-success", spoken: "Done" },
  waiting: { icon: Clock, className: "bg-attention-soft text-attention", spoken: "Waiting" },
  attention: { icon: TriangleAlert, className: "bg-attention-soft text-attention", spoken: "Needs attention" },
  todo: { icon: Minus, className: "bg-sunken text-ink-3", spoken: "Not yet" },
  stopped: { icon: X, className: "bg-danger-soft text-danger", spoken: "Stopped" },
};

/** The purchase as separate, record-backed steps: requested, priced, paid, then what the shop owes next. */
export function PurchaseLadder({ steps, className, clamp = true }: { steps: PurchaseStep[]; className?: string; /** Clip long details to two lines; pages with room show them in full. */ clamp?: boolean }) {
  return (
    <ol className={cx("flex flex-col", className)} aria-label="Where your purchase stands">
      {steps.map((step, index) => {
        const dot = DOT[step.state];
        const Icon = dot.icon;
        return (
          <li key={step.key} className="relative grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
            {index < steps.length - 1 ? <span aria-hidden className="bg-line absolute top-[34px] bottom-[-10px] left-[10.25px] w-[1.5px]" /> : null}
            <span className={cx("relative z-[1] grid size-[22px] place-items-center rounded-full", dot.className)}>
              <Icon aria-hidden size={13} strokeWidth={2.4} />
              <span className="sr-only">{dot.spoken}: </span>
            </span>
            <div className="min-w-0">
              <p className={cx("text-[14px] leading-snug font-medium", step.state === "todo" && "text-ink-2")}>{step.label}</p>
              {step.detail ? <p className={cx("text-ink-3 mt-0.5 text-[13px] leading-snug", clamp && "line-clamp-2")} title={clamp ? step.detail : undefined}>{step.detail}</p> : null}
            </div>
            {step.value ? <span className="tabular text-ink-2 text-[13px] font-medium">{step.value}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
