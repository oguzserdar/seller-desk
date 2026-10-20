import { SetupNavigation } from "./setup-navigation";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { DESK_THEME_COOKIE, deskThemeId } from "@/lib/desk-themes";
import { DeskThemePicker } from "./desk-theme-picker";
import { requireOwner } from "@/server/auth/owner";
import { getReadiness } from "@/server/domain/readiness";
import { ProfileForm } from "./profile-form";
import { ReadinessList } from "./readiness-list";
import { getServerConfig } from "@/server/env";
import { AiSetup } from "./ai-setup";
import { PayPalSetup } from "./paypal-setup";

export const metadata: Metadata = { title: "Setup" };

/** Owner setup, with public connection guidance and independently checked readiness. */
export default async function SetupPage() {
  const { seller } = await requireOwner(await headers());
  const readiness = await getReadiness(seller);
  const config = getServerConfig();
  const deskTheme = deskThemeId(
    (await cookies()).get(DESK_THEME_COOKIE)?.value,
  );
  return (
    <section className="w-full max-w-4xl px-4 py-8 sm:px-8">
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
        reply={
          config.ai.status === "ready"
            ? `${config.ai.modelId} through ${config.ai.provider}`
            : "Not connected"
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
      <PayPalSetup
        mode={config.mode}
        appUrl={config.appUrl}
        configured={config.paypal.status === "ready"}
      />
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
