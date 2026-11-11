import type { Metadata } from "next";
import { headers } from "next/headers";
import { InsightsLoader } from "@/components/insights/insights-loader";
import { requireOwner } from "@/server/auth/owner";
import { loadInsights } from "@/server/domain/insights";
import { getServerConfig } from "@/server/env";

export const metadata: Metadata = { title: "Insights" };

/** How the shop sold, how much the assistant handled alone, and how the catalog moves. */
export default async function InsightsPage() {
  const { owner } = await requireOwner(await headers());
  const data = await loadInsights(owner);
  return (
    <section className="flex min-h-full flex-col pt-8 pb-10">
      <div className="px-4 sm:px-8">
        <h1 className="page-title">Insights</h1>
        <p className="text-ink-2 mt-1 max-w-[64ch]">
          What sold, what the assistant handled on its own, and what is still waiting for you. Every amount is a payment PayPal confirmed.
        </p>
      </div>
      <InsightsLoader data={data} licenseKey={getServerConfig().agStudioLicense} />
    </section>
  );
}
