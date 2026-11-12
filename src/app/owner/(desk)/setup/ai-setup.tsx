import type { AiConnectionView } from "@/server/domain/ai-settings";
import { AiSettings } from "./ai-settings";

/** Keeps installation choices separate from the actual running configuration. */
export function AiSetup({
  reply,
  routing,
  routine,
  connection,
  readOnly = false,
}: {
  connection: AiConnectionView;
  /** A demo visitor sees what is connected; preparing a new connection and its key field are the owner's. */
  readOnly?: boolean;
  reply: string;
  routing: string;
  routine: string;
}) {
  return (
    <section
      id="assistant"
      aria-labelledby="assistant-heading"
      className="surface mt-8 scroll-mt-40 sm:scroll-mt-28 overflow-hidden"
    >
      <div className="border-line border-b px-5 py-6 sm:px-7">
        <h2
          id="assistant-heading"
          className="text-[22px] font-semibold tracking-tight"
        >
          Assistant
        </h2>
        <p className="text-ink-2 mt-2 max-w-xl text-[15px] leading-relaxed">
          Your assistant answers from your offers and approved shop facts.
          Anything that changes an order still needs your approval.
        </p>
      </div>
      <div className="px-5 pt-6 sm:px-7">
        {readOnly ? (
          <dl className="grid gap-3 pb-6 text-[14px] sm:grid-cols-[140px_1fr]">
            <dt className="text-ink-3">Connection</dt>
            <dd>{connection.provider ? connection.provider.charAt(0).toUpperCase() + connection.provider.slice(1) : "Not connected"}</dd>
            <dt className="text-ink-3">Reply model</dt>
            <dd className="break-words">{connection.modelId ?? "None"}</dd>
            <dt className="text-ink-3">Key</dt>
            <dd>{connection.keyMask ? "Set, hidden in the demo" : "Not set"}</dd>
            <dd className="text-ink-3 sm:col-span-2 text-[13px]">The owner connects their own AI provider and key here.</dd>
          </dl>
        ) : (
          <AiSettings connection={connection} />
        )}
      </div>
      <div className="border-line border-t bg-canvas px-5 sm:px-7">
        <details>
          <summary className="text-ink-2 min-h-12 cursor-pointer py-3 text-[13px] font-medium">
            What’s running now?
          </summary>
          <dl className="space-y-3 pb-5 text-[13px]">
            {[
              ["Replies", reply],
              ["Decisions", routing],
              ["Routine model", routine],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                <dt className="text-ink-3">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
        <details className="border-line border-t">
          <summary className="text-ink-2 min-h-12 cursor-pointer py-3 text-[13px] font-medium">
            Use a cheaper model for simple questions
          </summary>
          <div className="text-ink-2 space-y-3 pb-5 text-[13px]">
            <p>
              Optional. Set <code>AI_ROUTINE_MODEL_ID</code> to your chosen
              model. Set <code>AI_ROUTINE_PROVIDER</code> only for a different
              provider, and add its key. No extra model is selected by default.
            </p>
            <p>
              Only routine decisions with native probabilities use that model.
              Haiku classification keeps the main reply model. Uncertain
              decisions, payment recovery and complex requests use the main
              reply model. All models have the same permission checks.
            </p>
            <p>
              The starting probability threshold is 0.95, not a measured
              accuracy guarantee. Test your conversations before choosing a
              cheaper model.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
