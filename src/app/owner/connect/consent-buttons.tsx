"use client";

import { useAction } from "next-safe-action/hooks";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { answerConnector } from "./actions";

/** Allow or deny an AI app's access request, then hand the browser back to the app. */
export function ConsentButtons({ oauthQuery, appName }: { oauthQuery: string; appName: string }) {
  const { execute, isPending, input, result } = useAction(answerConnector, {
    onSuccess: ({ data }) => { if (data) window.location.assign(data.redirectTo); },
  });
  return (
    <div className="mt-8 flex flex-col gap-3">
      {result.serverError ? <Alert tone="danger" title={result.serverError} /> : null}
      <Button onClick={() => execute({ accept: true, oauthQuery })} loading={isPending && input?.accept === true} disabled={isPending}>
        Allow {appName}
      </Button>
      <Button variant="ghost" onClick={() => execute({ accept: false, oauthQuery })} loading={isPending && input?.accept === false} disabled={isPending}>
        Deny
      </Button>
    </div>
  );
}
