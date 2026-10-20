"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { reconcilePaymentAction } from "../../actions";

export function ReconcileButton({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const check = useAction(reconcilePaymentAction, {
    onSuccess: ({ data }) => {
      setMessage(data ? `${data.headline}. ${data.detail}` : "Checked.");
      router.refresh();
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <Button className="self-start" loading={check.isPending} onClick={() => check.execute({ attemptId })}>
        Check with PayPal now
      </Button>
      {check.result.serverError ? <Alert tone="danger" title={check.result.serverError} /> : null}
      {message ? <Alert tone="info" title={message} /> : null}
    </div>
  );
}
