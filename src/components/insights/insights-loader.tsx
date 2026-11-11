"use client";

import dynamic from "next/dynamic";
import type { InsightsData } from "@/server/domain/insights";

// Studio draws in the browser only and is large, so it loads on this page alone, after the shell.
const Studio = dynamic(() => import("./insights-studio").then((module) => module.InsightsStudio), {
  ssr: false,
  loading: () => <div className="text-ink-3 px-4 py-16 text-center text-[14px] sm:px-8">Loading the dashboard…</div>,
});

/** Client boundary for the Insights page. */
export function InsightsLoader(props: { data: InsightsData; licenseKey?: string; viewer?: boolean }) {
  return <Studio {...props} />;
}
