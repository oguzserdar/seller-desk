import Link from "next/link";
import { Badge } from "@/components/arc/badge/badge";
import type { Readiness } from "@/server/domain/readiness";
import { ModelCheckButton } from "./model-check-button";

const STATE_LABEL = {
  pass: "Done",
  fail: "To do",
  fixture: "Simulated",
  pending: "Check",
  configured: "Configured",
} as const;
const STATE_TONE = {
  pass: "success",
  fail: "warning",
  fixture: "neutral",
  pending: "warning",
  configured: "neutral",
} as const;

/** Shows configuration and executed checks without treating them as equivalent proof. */
export function ReadinessList({ readiness }: { readiness: Readiness }) {
  const tone =
    readiness.summary.state === "not_ready"
      ? "warning"
      : readiness.summary.state === "fixture_ready"
        ? "neutral"
        : "success";
  return (
    <section className="surface overflow-hidden">
      <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-[17px] font-semibold">Readiness</h2>
        <Badge tone={tone}>{readiness.summary.label}</Badge>
      </div>
      <ul className="divide-line divide-y">
        {readiness.checks.map((check) => (
          <li
            key={check.key}
            className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-start sm:gap-4"
          >
            <div className="flex w-44 shrink-0 items-center gap-2">
              <Badge tone={STATE_TONE[check.state]}>
                {STATE_LABEL[check.state]}
              </Badge>
              <span className="text-[15px] font-semibold">{check.label}</span>
            </div>
            <p className="text-ink-2 flex-1 text-[15px]">
              {check.detail}
              {check.fix ? (
                <>
                  {" "}
                  <Link
                    href={check.fix.href}
                    className="text-brand font-semibold hover:underline"
                  >
                    {check.fix.label}
                  </Link>
                </>
              ) : null}
              {check.action === "check_model" ? <ModelCheckButton /> : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
