"use client";

import { useMemo, useRef, useState } from "react";
import type { AgReportState, AgStudioApi, AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { InsightsData } from "@/server/domain/insights";
import { studioData } from "./studio-data";
import { INSIGHT_PAGES, insightsReport } from "./studio-report";
import { deskStudioTheme } from "./studio-theme";

/**
 * The owner's Insights dashboard: AG Studio over the shop's own orders, conversations and offers.
 * Our tabs choose the page; Edit lets the owner rearrange or add widgets for this visit.
 */
export function InsightsStudio({ data, licenseKey }: { data: InsightsData; licenseKey?: string }) {
  const api = useRef<AgStudioApi | null>(null);
  const [page, setPage] = useState<string>(insightsReport.selectedPageId ?? INSIGHT_PAGES[0].id);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const sources = useMemo(() => studioData(data), [data]);

  const open = (id: string) => {
    setPage(id);
    const current = api.current?.getState();
    if (current) api.current?.setState({ ...current, selectedPageId: id } as AgReportState);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2 sm:px-8">
        <div role="tablist" aria-label="Dashboard pages" className="bg-sunken inline-flex rounded-[10px] p-1">
          {INSIGHT_PAGES.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={page === item.id}
              onClick={() => open(item.id)}
              className={
                page === item.id
                  ? "bg-surface text-ink rounded-[7px] px-3.5 py-1.5 text-[14px] font-medium shadow-[0_0_0_1px_var(--color-line)]"
                  : "text-ink-2 hover:text-ink rounded-[7px] px-3.5 py-1.5 text-[14px] font-medium"
              }
            >
              {item.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === "view" ? "edit" : "view")}
          aria-pressed={mode === "edit"}
          className="border-line-strong hover:bg-sunken rounded-[var(--radius-control)] border px-3.5 py-1.5 text-[14px] font-medium"
        >
          {mode === "view" ? "Edit dashboard" : "Done editing"}
        </button>
      </div>
      <div className="h-[980px] flex-none">
        <AgStudioProvider licenseKey={licenseKey}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={deskStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            // No side panel while reading; editing brings the data and widget panels.
            panels={{ view: { left: [], right: [] }, edit: { right: ["edit", "data"] } }}
            data={sources}
            initialState={insightsReport}
            mode={mode}
            onApiReady={(event) => {
              api.current = event.api;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
