import { getAssistantModel } from "@/server/ai/registry";
import { SetupNavigation } from "./setup-navigation";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { DESK_THEME_COOKIE, deskThemeId } from "@/lib/desk-themes";
import { DeskThemePicker } from "./desk-theme-picker";
import { requireOwner } from "@/server/auth/owner";
import { getReadiness } from "@/server/domain/readiness";
import { ProfileForm } from "./profile-form";
import { ReadinessList } from "./readiness-list";
import { describeAiConnection } from "@/server/domain/ai-settings";
import { getEffectiveConfig } from "@/server/effective-config";
import { AiSetup } from "./ai-setup";
import { PayPalSetup } from "./paypal-setup";
import { PayPalToolkit } from "./paypal-toolkit";
import { payPalToolkitState } from "@/server/paypal/agent-toolkit";
import { AiApps } from "./ai-apps";
import { setupLine } from "@/lib/agent-setup";
import { allowedApps } from "@/server/connector/access";
import { connectorResource } from "@/server/auth/connector";

export const metadata: Metadata = { title: "Setup" };

/** Owner setup, with public connection guidance and independently checked readiness. */
export default async function SetupPage() {
  const { seller, owner, viewer } = await requireOwner(await headers());
  const checked = await getReadiness(seller);
  // A demo visitor is not the owner: say so, rather than "Signed in as the owner".
  const readiness = viewer
    ? { ...checked, checks: checked.checks.map((check) => (check.key === "owner" ? { ...check, detail: "You are looking around as a demo visitor. The owner signs in to change anything." } : check)) }
    : checked;
  const [config, connection, apps, assistant] = await Promise.all([getEffectiveConfig(), describeAiConnection(), allowedApps(owner.userId), getAssistantModel()]);
  const deskTheme = deskThemeId(
    (await cookies()).get(DESK_THEME_COOKIE)?.value,
  );
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <h1 className="page-title">Setup</h1>
      <p className="text-ink-2 mt-1">
        Check your shop, payments and optional AI assistant. Buyers can browse
        and buy without AI.
      </p>
      <SetupNavigation />
      <div id="overview" className="mt-6 scroll-mt-40 sm:scroll-mt-28">
        <ReadinessList readiness={readiness} />
      </div>
      <AiSetup
        // A demo visitor sees that a key is set, never any part of it.
        connection={viewer ? { ...connection, keyMask: connection.keyMask ? "hidden in the demo" : null } : connection}
        reply={
          config.ai.status !== "ready"
            ? "Not connected"
            : assistant.ok
              ? `${config.ai.modelId} through ${config.ai.provider}`
              : `${config.ai.modelId} through ${config.ai.provider}. Off now: ${assistant.problem}`
        }
        routing={
          config.routing.status === "off"
            ? "Off; reply model handles turns directly"
            : config.routing.status === "ready"
              ? `${config.routing.modelId} through ${config.routing.provider}. Connection check required.`
              : "Not connected; reply model can still answer"
        }
        routine={
          config.routineAi?.status === "ready"
            ? `${config.routineAi.modelId} through ${config.routineAi.provider}`
            : config.routineAi
              ? "Settings incomplete"
              : "Off; using the reply model for all answers"
        }
      />
      <AiApps address={connectorResource(config.appUrl)} agentLine={setupLine(config.appUrl)} apps={viewer ? [] : apps} />
      <PayPalSetup
        mode={config.mode}
        appUrl={config.appUrl}
        configured={config.paypal.status === "ready"}
      />
      <PayPalToolkit state={await payPalToolkitState()} />
      <DeskThemePicker current={deskTheme} />
      <ProfileForm
        initial={{
          policyRevision: seller.policyRevision,
          displayName: seller.displayName,
          contactEmail: seller.contactEmail,
          country: seller.country,
          currency: seller.currency,
          pickupPolicy: seller.pickupPolicy,
          serviceRequestPolicy: seller.serviceRequestPolicy,
          digitalAccessPolicy: seller.digitalAccessPolicy,
          cancellationPolicy: seller.cancellationPolicy,
          taxPolicy: seller.taxPolicy,
          allowedOrigins: seller.allowedOrigins,
          buyerTurnsPer10Min: seller.buyerTurnsPer10Min,
          sellerDailyAiTurns: seller.sellerDailyAiTurns,
          theme: seller.theme,
        }}
      />
    </section>
  );
}
