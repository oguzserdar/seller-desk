import { Check, X } from "lucide-react";
import { Badge } from "@/components/arc/badge/badge";
import { CONNECTOR_CAN, CONNECTOR_CANNOT } from "@/lib/connector-scope";
import type { AllowedApp } from "@/server/connector/access";
import { CopyField } from "../install/copy-field";
import { RemoveAiAppButton } from "./remove-ai-app-button";

/**
 * How the owner connects their own AI apps: one line for a coding agent first (it sets itself up),
 * the connector address for chat apps second, what a connected app can and can never do, and the
 * whether they may answer customers, and the apps allowed so far. The can/cannot lists are the
 * consent page's own, so both say the same thing. A demo visitor (readOnly) sees the switch disabled.
 */
export function AiApps({ address, agentLine, apps, readOnly }: { address: string; agentLine: string; apps: AllowedApp[]; readOnly: boolean }) {
  return (
    <section id="ai-apps" aria-labelledby="ai-apps-heading" className="surface mt-8 scroll-mt-40 sm:scroll-mt-28 px-5 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ai-apps-heading" className="text-[22px] font-semibold">Your AI apps</h2>
        <Badge tone="neutral">{apps.length ? `${apps.length} connected` : "None connected"}</Badge>
      </div>
      <p className="text-ink-2 mt-2 max-w-2xl text-[15px]">
        Ask your own AI what needs you today. It reads your desk; it answers a customer only if you turn that on below.
      </p>

      <div className="bg-sunken mt-5 rounded-xl px-4 py-4">
        <h3 className="text-[15px] font-semibold">Claude Code, Codex or Cursor</h3>
        <p className="text-ink-2 mt-1 mb-3 text-[14px]">
          Paste this line into it. It adds the connector and the Seller Desk skill itself, then asks you to sign in.{" "}
          <a href="/.well-known/agent-skills/seller-desk/SKILL.md" className="text-ink underline underline-offset-2" target="_blank" rel="noreferrer">
            Read the skill
          </a>
        </p>
        <CopyField label="Line for a coding agent" value={agentLine} multiline />
      </div>

      <div className="bg-sunken mt-3 rounded-xl px-4 py-4">
        <h3 className="text-[15px] font-semibold">ChatGPT or Claude</h3>
        <p className="text-ink-2 mt-1 mb-3 text-[14px]">Add this address as a custom connector in the app&apos;s settings, then sign in when it asks.</p>
        <CopyField label="Connector address" value={address} />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-[15px] font-semibold">A connected app can</h3>
          <ul className="mt-2 flex flex-col gap-2 text-[14px]">
            {CONNECTOR_CAN.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check aria-hidden className="text-success mt-0.5 size-4 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[15px] font-semibold">It can never</h3>
          <ul className="mt-2 flex flex-col gap-2 text-[14px]">
            {CONNECTOR_CANNOT.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <X aria-hidden className="text-danger mt-0.5 size-4 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-ink-2 mt-6 text-[14px]">Whether a connected app may answer customers is set under <a href="#answers" className="text-ink font-medium underline underline-offset-4">Who answers customers&apos; waiting questions</a>.</p>

      {apps.length ? (
        <>
          <h3 className="mt-6 text-[15px] font-semibold">Allowed apps</h3>
          <ul className="mt-1 divide-y divide-line">
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
        </>
      ) : null}
    </section>
  );
}
