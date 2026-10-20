"use client";

import { CopyButton } from "@/components/arc/copy-button/copy-button";

/** Displays a server address or snippet with Arc's real clipboard action and feedback. */
export function CopyField({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <code
        className={`text-ink min-w-0 flex-1 font-mono text-sm leading-relaxed ${multiline ? "break-all whitespace-pre-wrap" : "truncate"}`}
        aria-label={label}
      >
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}
