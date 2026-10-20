"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { checkPayPalAction } from "./actions";

/** Runs a read-only sandbox diagnostic and shows only the scope it actually checked. */
export function PayPalCheckButton() {
  const check = useAction(checkPayPalAction);
  const result = check.result.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          loading={check.isPending}
          onClick={() => check.execute()}
        >
          Check PayPal connection
        </Button>
        <p className="text-ink-3 text-[13px]">
          Checks settings only. No payment is made.
        </p>
      </div>
      {!check.isPending && result ? (
        result.ok ? (
          <Alert tone="success" title="App and webhook settings checked">
            PayPal accepted the app credentials. The registered webhook has the
            expected address and events. Delivery, the receiving merchant and
            checkout still need a sandbox purchase.
          </Alert>
        ) : (
          <Alert tone="warning" title="Connection needs attention">
            {result.problem}
          </Alert>
        )
      ) : null}
      {check.result.serverError ? (
        <Alert tone="danger" title={check.result.serverError} />
      ) : null}
    </div>
  );
}
