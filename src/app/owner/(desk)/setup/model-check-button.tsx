"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { Button } from "@/components/arc/button/button";
import { checkModelAction } from "./actions";

/** Checks the configured model's tool use and structured reply, then refreshes readiness. */
export function ModelCheckButton() {
  const router = useRouter();
  const check = useAction(checkModelAction, {
    onSettled: () => router.refresh(),
  });
  return (
    <span className="mt-2 flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        loading={check.isPending}
        onClick={() => check.execute()}
      >
        Check AI connection
      </Button>
      <span className="text-ink-3 text-[13px]">
        Checks enabled models in sequence. Up to five small requests; provider
        usage may apply.
      </span>
      {check.result.serverError ? (
        <span className="text-danger text-[14px]">
          {check.result.serverError}
        </span>
      ) : null}
    </span>
  );
}
