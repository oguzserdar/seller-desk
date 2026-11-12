"use client";

import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { Switch } from "@/components/arc/switch/switch";
import { setConnectorAnswersAction } from "./actions";

/**
 * The owner's choice to let connected AI apps answer customers' waiting questions as them.
 * Off by default; the demo visitor sees it disabled. The connector checks the saved value on every call.
 */
export function ConnectorAnswersSwitch({ allowed, readOnly }: { allowed: boolean; readOnly: boolean }) {
  const id = useId();
  const [on, setOn] = useState(allowed);
  const save = useAction(setConnectorAnswersAction, {
    onSuccess: ({ data }) => { if (data) setOn(data.allowed); },
    onError: () => setOn(allowed),
  });
  const error = save.result.serverError;
  return (
    <div className="bg-sunken mt-6 rounded-xl px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} className="text-[15px] font-semibold">Let connected AI apps answer customers&apos; waiting questions as you</label>
          <p id={`${id}-hint`} className="text-ink-2 mt-1 text-[14px]">
            Off: they can only read. On: an answer they send reaches the customer as if you wrote it on the desk.
          </p>
        </div>
        <Switch
          id={id}
          aria-describedby={`${id}-hint`}
          checked={on}
          disabled={readOnly || save.isPending}
          onCheckedChange={(next) => { setOn(next); save.execute({ allowed: next }); }}
        />
      </div>
      {error ? <p role="alert" className="text-danger mt-2 text-[13px]">{error}</p> : null}
    </div>
  );
}
