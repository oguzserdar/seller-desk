"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import {
  ModelSelector,
  type ModelChoice,
} from "@/components/assistant/internal/model-selector";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import type { AiConnectionView } from "@/server/domain/ai-settings";
import { CopyField } from "../install/copy-field";
import { listAiModelsAction } from "./actions";
import { AiKeyForm } from "./ai-key-form";

const PROVIDERS = {
  gateway: {
    label: "Vercel AI Gateway",
    description: "One key for replies and Jev",
    model: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    key: "AI_GATEWAY_API_KEY",
    link: "https://vercel.com/docs/ai-gateway/authentication-and-byok",
  },
  openrouter: {
    label: "OpenRouter",
    description: "One key for replies and Jev",
    model: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    key: "OPENROUTER_API_KEY",
    link: "https://openrouter.ai/keys",
  },
  anthropic: {
    label: "Anthropic",
    description: "Connect directly with your Anthropic key",
    model: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    key: "ANTHROPIC_API_KEY",
    link: "https://platform.claude.com/",
  },
  openai: {
    label: "OpenAI",
    description: "Connect directly with your OpenAI key",
    model: "gpt-5-mini",
    name: "GPT-5 mini",
    key: "OPENAI_API_KEY",
    link: "https://platform.openai.com/api-keys",
  },
  google: {
    label: "Google",
    description: "Connect directly with your Google key",
    model: "gemini-3.1-flash",
    name: "Gemini 3.1 Flash",
    key: "GOOGLE_GENERATIVE_AI_API_KEY",
    link: "https://aistudio.google.com/api-keys",
  },
} as const;
const ROUTING_CONNECTIONS = {
  off: {
    label: "Off",
    description: "Your reply model handles each turn directly",
    model: "",
    key: "",
    group: "No extra request",
  },
  gateway: {
    label: "Jev through Vercel",
    description: "Uses an AI Gateway key",
    model: "typesafe-ai/jev",
    key: "AI_GATEWAY_API_KEY",
    group: "Dedicated decisions",
  },
  openrouter: {
    label: "Jev through OpenRouter",
    description: "Uses an OpenRouter key",
    model: "typesafe/jev-1.13",
    key: "OPENROUTER_API_KEY",
    group: "Dedicated decisions",
  },
  typesafe: {
    label: "Jev directly",
    description: "Uses a TypeSafe AI key",
    model: "jev-1.13.0",
    key: "TYPESAFE_AI_API_KEY",
    group: "Dedicated decisions",
  },
  openai: {
    label: "OpenAI Decisions",
    description: "Uses an OpenAI key; currently in public beta",
    model: "gpt-6-luna",
    key: "OPENAI_API_KEY",
    group: "Dedicated decisions",
  },
  anthropic: {
    label: "Claude Haiku",
    description: "Uses an Anthropic key; classifies without probabilities",
    model: "claude-haiku-5-5",
    key: "ANTHROPIC_API_KEY",
    group: "Structured classification",
  },
} as const;
const routingChoices: ModelChoice[] = Object.entries(ROUTING_CONNECTIONS).map(
  ([id, item]) => ({ id, ...item }),
);
const connections: ModelChoice[] = Object.entries(PROVIDERS).map(([id, p]) => ({
  id,
  label: p.label,
  description: p.description,
  group:
    id === "gateway" || id === "openrouter"
      ? "Through a gateway"
      : "Direct connection",
}));

/** Produces installation instructions only. Keys stay in the private server environment. */
export function AiSettings({ connection }: { connection: AiConnectionView }) {
  const start = (connection.provider && connection.provider in PROVIDERS ? connection.provider : "gateway") as keyof typeof PROVIDERS;
  const [provider, setProvider] = useState<keyof typeof PROVIDERS>(start);
  const [customModel, setCustomModel] = useState(Boolean(connection.modelId && connection.modelId !== PROVIDERS[start].model));
  const [model, setModel] = useState<string>(connection.modelId ?? PROVIDERS[start].model);
  const [routing, setRouting] =
    useState<keyof typeof ROUTING_CONNECTIONS>("off");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const listing = useAction(listAiModelsAction, {
    onSuccess: ({ data }) => {
      if (data?.ok)
        setModels(data.models.map((m) => ({ id: m.id, label: m.label, description: m.id, group: `From ${PROVIDERS[provider].label}` })));
    },
  });
  const listed = listing.result.data;
  const canList = apiKey.trim().length >= 20 || connection.provider === provider;
  const decision = ROUTING_CONNECTIONS[routing];
  const selected = PROVIDERS[provider];
  const safeModel = model.trim().replace(/[\r\n"'$`\\#]/g, "");
  const choices: ModelChoice[] = [
    ...(models ?? [
      {
        id: selected.model,
        label: selected.name,
        description: "Load models to see everything this key can use",
        group: "Reply model",
      },
    ]),
    {
      id: "custom",
      label: "Use another model",
      description: "Enter a model ID from your provider",
      group: "Your choice",
    },
  ];
  const settings = [
    `AI_PROVIDER=${provider}`,
    `AI_MODEL_ID=${safeModel}`,
    `${selected.key}=`,
    `AI_ROUTING_PROVIDER=${routing}`,
    `AI_ROUTING_MODEL_ID=${decision.model}`,
    "AI_ROUTINE_PROVIDER=",
    "AI_ROUTINE_MODEL_ID=",
    ...(decision.key && decision.key !== selected.key
      ? [`${decision.key}=`]
      : []),
  ].join("\n");
  return (
    <div>
      <p className="text-ink-3 mb-5 text-[13px]">
        Prepare a new connection below. Apply it on your host when you’re ready.
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-ink-2 text-[13px] font-medium">Connection</p>
          <ModelSelector
            title="Choose a connection"
            value={provider}
            label={selected.label}
            description={selected.description}
            choices={connections}
            onSelect={(id) => {
              const next = id as keyof typeof PROVIDERS;
              setProvider(next);
              setModel(PROVIDERS[next].model);
              setCustomModel(false);
              setModels(null);
              setApiKey("");
              listing.reset();
            }}
          />
        </div>
        <div className="space-y-2">
          <Input
            label={`${selected.label} key`}
            id="ai-key"
            type="password"
            value={apiKey}
            maxLength={400}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          loading={listing.isPending}
          disabled={!canList}
          onClick={() => listing.execute({ provider, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })}
        >
          Load models from {selected.label}
        </Button>
        <p role="status" className="text-ink-3 text-[13px]">
          {listing.isPending
            ? "Asking the provider…"
            : listed?.ok
              ? `${listed.models.length} chat models available to this key.`
              : listed && !listed.ok
                ? listed.problem
                : listing.result.serverError ?? "The list comes from the provider, for this key."}
        </p>
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <p className="text-ink-2 text-[13px] font-medium">Replies</p>
          <ModelSelector
            title="Choose a reply model"
            value={customModel ? "custom" : model}
            label={customModel ? model || "Your model" : (models?.find((m) => m.id === model)?.label ?? (model || selected.name))}
            description={
              customModel
                ? "Custom model ID"
                : "Reads your shop and answers customers"
            }
            choices={choices}
            onSelect={(id) => {
              setCustomModel(id === "custom");
              setModel(id === "custom" ? "" : id);
            }}
          />
        </div>
      </div>
      {customModel ? (
        <div className="mt-4">
          <Input
            label="Model ID"
            description="Copy the exact ID from your provider. It must support tools and structured output."
            id="ai-model"
            aria-describedby="ai-model-hint"
            value={model}
            maxLength={200}
            onChange={(e) => setModel(e.target.value)}
            autoComplete="off"
          />
        </div>
      ) : null}
      <AiKeyForm connection={connection} provider={provider} modelId={safeModel} apiKey={apiKey.trim()} onSaved={() => setApiKey("")} />
      <div className="border-line mt-6 space-y-3 border-y py-5">
        <p className="text-[15px] font-semibold">
          Guide conversations before replying
        </p>
        <p className="text-ink-2 max-w-lg text-[14px] leading-relaxed">
          Optional. Classify questions, payment problems and requests that need
          you. Your reply model still writes the answer.
        </p>
        <ModelSelector
          title="Choose conversation routing"
          value={routing}
          label={decision.label}
          description={decision.description}
          choices={routingChoices}
          onSelect={(id) => setRouting(id as keyof typeof ROUTING_CONNECTIONS)}
        />
        {routing === "anthropic" ? (
          <p className="text-ink-3 text-[12px]">
            Haiku provides handling guidance. It does not select a cheaper reply
            model without native probabilities.
          </p>
        ) : routing !== "off" ? (
          <p className="text-ink-3 text-[12px]">
            Adds one decision request. Provider access and usage charges apply;
            test response time and quality before enabling it.
          </p>
        ) : null}
      </div>
      <details className="group/install mt-1">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
          <span>Get installation settings</span>
          <ChevronRight
            size={17}
            aria-hidden
            className="shrink-0 transition-transform group-open/install:rotate-90"
          />
        </summary>
        <div className="space-y-4 pb-4">
          <p className="text-ink-2 text-[14px]">
            These choices prepare your settings. They do not change the running
            assistant.
          </p>
          {safeModel ? (
            <CopyField
              label="Private AI environment settings"
              value={settings}
              multiline
            />
          ) : (
            <p role="status" className="text-attention text-[14px]">
              Enter a model ID to prepare your settings.
            </p>
          )}
          <ol className="text-ink-2 list-decimal space-y-2 pl-5 text-[14px]">
            <li>
              Add these settings and your key to your private hosting
              environment.
            </li>
            <li>Restart or redeploy Seller Desk.</li>
            <li>
              Use <strong>Check AI connection</strong> at the top of this page.
            </li>
          </ol>
          <div className="flex flex-wrap gap-x-5 text-[14px] font-medium">
            <a
              className="text-brand inline-flex min-h-11 items-center gap-1 hover:underline"
              href={selected.link}
              target="_blank"
              rel="noreferrer"
            >
              Get {selected.label} key <ArrowUpRight size={15} aria-hidden />
            </a>
            {routing === "typesafe" ? (
              <a
                className="text-brand inline-flex min-h-11 items-center gap-1 hover:underline"
                href="https://docs.typesafe.ai"
                target="_blank"
                rel="noreferrer"
              >
                Get TypeSafe key <ArrowUpRight size={15} aria-hidden />
              </a>
            ) : null}
          </div>
          <p className="text-ink-3 text-[12px]">
            Vercel: project environment variables. Cloudflare: worker secrets or{" "}
            <code>.dev.vars</code>. Local: <code>.env.local</code>. Keep keys
            out of WordPress and the widget.
          </p>
        </div>
      </details>
    </div>
  );
}
