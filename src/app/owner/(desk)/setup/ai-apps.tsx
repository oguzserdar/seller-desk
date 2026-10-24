import { Badge } from "@/components/arc/badge/badge";
import type { AllowedApp } from "@/server/connector/access";
import { CopyField } from "../install/copy-field";
import { RemoveAiAppButton } from "./remove-ai-app-button";

/** The connector address to paste into an AI app, and the apps the owner has allowed so far. */
export function AiApps({ address, apps }: { address: string; apps: AllowedApp[] }) {
  return (
    <section id="ai-apps" aria-labelledby="ai-apps-heading" className="surface mt-8 scroll-mt-40 sm:scroll-mt-28 px-5 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ai-apps-heading" className="text-[22px] font-semibold">Your AI apps</h2>
        <Badge tone="neutral">{apps.length ? `${apps.length} connected` : "None connected"}</Badge>
      </div>
      <p className="text-ink-2 mt-2 max-w-2xl text-[15px]">
        Connect ChatGPT, Claude, Claude Code or Codex to your desk. They can read what is waiting, your conversations,
        orders and offers. They cannot message buyers or change anything; you send replies from here.
      </p>
      <div className="bg-sunken mt-4 rounded-xl px-4 py-3">
        <p className="text-ink-2 mb-1 text-[13px]">Add this address as a custom connector in your AI app:</p>
        <CopyField label="Connector address" value={address} />
      </div>
      {apps.length ? (
        <ul className="mt-5 divide-y divide-line">
          {apps.map((app) => (
            <li key={app.consentId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{app.name}</p>
                <p className="text-ink-3 truncate text-[13px]">
                  Allowed {new Date(app.allowedAt).toISOString().slice(0, 10)}{app.site ? ` · ${app.site}` : ""}
                </p>
              </div>
              <RemoveAiAppButton consentId={app.consentId} name={app.name} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
