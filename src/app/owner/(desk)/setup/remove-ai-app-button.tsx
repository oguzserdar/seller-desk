"use client";

import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/arc/button/button";
import { removeAiAppAction } from "./actions";

/** Removes one connected AI app; the list refreshes from the server afterwards. */
export function RemoveAiAppButton({ consentId, name }: { consentId: string; name: string }) {
  const { execute, isPending } = useAction(removeAiAppAction);
  return (
    <Button variant="ghost" size="sm" loading={isPending} onClick={() => execute({ consentId })} aria-label={`Remove ${name}`}>
      Remove
    </Button>
  );
}
