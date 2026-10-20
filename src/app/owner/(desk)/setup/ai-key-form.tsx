"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import type { AiConnectionView } from "@/server/domain/ai-settings";
import type { AiProviderName } from "@/server/env";
import { removeAiConnectionAction, saveAiConnectionAction } from "./actions";

/**
 * Saves the selected provider, model and key in the app. The key goes to the
 * server once, is tested with one model call, and is stored encrypted; the page
 * only ever receives its mask.
 */
export function AiKeyForm({
  connection,
  provider,
  providerLabel,
  modelId,
}: {
  connection: AiConnectionView;
  provider: AiProviderName;
  providerLabel: string;
  modelId: string;
}) {
  const [apiKey, setApiKey] = useState("");
  const save = useAction(saveAiConnectionAction, { onSuccess: ({ data }) => { if (data?.ok) setApiKey(""); } });
  const remove = useAction(removeAiConnectionAction);
  const saved = save.result.data;

  return (
    <div className="border-line mt-6 space-y-4 border-t pt-5">
      <div>
        <p className="text-[15px] font-semibold">Connect in Seller Desk</p>
        <p className="text-ink-2 mt-1 max-w-lg text-[14px] leading-relaxed">
          Paste your {providerLabel} key. Seller Desk sends one short test
          request, then stores the key encrypted. It is never shown again.
        </p>
      </div>

      {connection.source === "saved" ? (
        <div className="flex flex-wrap items-center gap-3 text-[14px]">
          <span>
            Saved here: <code>{connection.keyMask}</code> · {connection.modelId}
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

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.execute({ provider, modelId, apiKey });
        }}
      >
        <div className="min-w-0 flex-1 basis-64">
          <Input
            label={`${providerLabel} key`}
            id="ai-key"
            type="password"
            value={apiKey}
            maxLength={400}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          loading={save.isPending}
          disabled={apiKey.trim().length < 20 || !modelId}
        >
          Test and save
        </Button>
      </form>

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
        <Alert tone="warning" title="Check the key and model ID, then try again." />
      ) : null}
      {remove.result.serverError ? <Alert tone="danger" title={remove.result.serverError} /> : null}
    </div>
  );
}
