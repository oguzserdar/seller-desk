"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/arc/select/select";

const LABELS: Record<string, string> = {
  all_orders: "All orders",
  pickup_pending: "Ready for pickup",
  service_followup: "Service work",
  access_failed: "Downloads unopened",
  payments_uncertain: "Payments to check",
  quotes_awaiting_review: "Quotes to review",
  completed: "Fulfilled",
};

/** The less common desk views, one choice away. */
export function ViewSelect({
  current,
  options,
}: {
  current: string;
  options: { value: string; label: string; count: number }[];
}) {
  const router = useRouter();
  const selected = options.some((option) => option.value === current)
    ? current
    : "";
  return (
    <div className="desk-views">
      <Select
        label="Order view"
        placeholder="Choose a view"
        value={selected}
        options={options.map((option) => ({
          value: option.value,
          label: LABELS[option.value] ?? option.label,
          count: option.count,
        }))}
        onValueChange={(value) => {
          if (value) router.push(`/owner/orders?view=${value}`);
        }}
      />
    </div>
  );
}
