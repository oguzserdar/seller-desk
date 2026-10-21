"use client";

import { useAction } from "next-safe-action/hooks";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import type { AiConnectionView } from "@/server/domain/ai-settings";
import type { AiProviderName } from "@/server/env";
import { removeAiConnectionAction, saveAiConnectionAction } from "./actions";

/**
 * Saves the chosen provider, model and pasted key in the app. The key goes to
 * the server once, is tested with one model call, and is stored encrypted; the
 * page only ever receives its mask.
 */
export function AiKeyForm({
  connection,
  provider,
  modelId,
  apiKey,
  onSaved,
}: {
  connection: AiConnectionView;
  provider: AiProviderName;
  modelId: string;
  apiKey: string;
  onSaved: () => void;
}) {
  const save = useAction(saveAiConnectionAction, { onSuccess: ({ data }) => { if (data?.ok) onSaved(); } });
  const remove = useAction(removeAiConnectionAction);
  const saved = save.result.data;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          loading={save.isPending}
          disabled={apiKey.trim().length < 20 || !modelId}
          onClick={() => save.execute({ provider, modelId, apiKey })}
        >
          Test and save
        </Button>
        <p className="text-ink-3 text-[13px]">
          One short test request, then the key is stored encrypted and never shown again.
        </p>
      </div>

      {connection.source === "saved" ? (
        <div className="flex flex-wrap items-center gap-3 text-[14px]">
          <span>
            Connected: <code>{connection.keyMask}</code> · {connection.modelId}
          </span>
          <Button
            variant="secondary"
            size="sm"
            loading={remove.isPending}
            onClick={() => remove.execute()}
          >
            Remove saved key
          </Button>
        </div>
      ) : connection.source === "environment" ? (
        <p className="text-ink-3 text-[13px]">
          Running on the key from your host settings (
          <code>{connection.keyMask ?? "hosted sign-in"}</code>). A key saved
          here replaces it until you remove it.
        </p>
      ) : null}

      {connection.unreadable ? (
        <Alert tone="warning" title="A saved key can’t be opened">
          This installation’s secret changed since the key was saved. Save
          your AI key again, or remove it.
        </Alert>
      ) : null}

      {!save.isPending && saved ? (
        saved.ok ? (
          <Alert tone="success" title="Key saved">
            {modelId} answered in {saved.latencyMs} ms. Saved as{" "}
            <code>{saved.keyMask}</code>.
          </Alert>
        ) : (
          <Alert tone="warning" title="Not saved">
            {saved.problem}
          </Alert>
        )
      ) : null}
      {save.result.serverError ? <Alert tone="danger" title={save.result.serverError} /> : null}
      {save.result.validationErrors ? (
        <Alert tone="warning" title="Check the key and model, then try again." />
      ) : null}
      {remove.result.serverError ? <Alert tone="danger" title={remove.result.serverError} /> : null}
    </div>
  );
}
