"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgStudioAiModule, createAiHarness, type AgPanelConfig, type AgReportState, type AgStudioApi } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import type { InsightsData } from "@/server/domain/insights";
import { studioData } from "./studio-data";
import { INSIGHT_PAGES, PHONE_WIDTH, insightsReport, pageHeight, phonePageHeight, stackForPhone } from "./studio-report";
import { deskStudioTheme } from "./studio-theme";
import { SELLER_DESK_WIDGETS } from "./studio-widgets";
import { sellerDeskAdapter } from "./studio-adapter";

const MODULES = [AgStudioAiModule];

// Questions a shop owner asks about the week; each one runs against this page's data.
const STARTERS = [
  { label: "What sold best?", prompt: "Which products brought in the most revenue, and how much each?" },
  { label: "Who is waiting?", prompt: "Which customers are waiting for my answer, and what do they want?" },
  { label: "Add a chart", prompt: "Add a chart of units sold by product to this page." },
];

// On a phone every card goes full width, in reading order.
const BREAKPOINTS = [{ maxWidth: PHONE_WIDTH - 1, layout: (cards: { layout: { xTrack: number; yTrack: number; xSpan: number; ySpan: number } }[], grid: { columns: number }) => stackForPhone(cards.map((card) => card.layout), grid.columns) }];

type Panel = "none" | "analyst" | "edit";
const PANELS: Record<Panel, AgPanelConfig> = {
  none: { view: { left: [], right: [] } },
  analyst: { view: { left: [], right: [] }, edit: { left: [], right: ["ai"] } },
  edit: { view: { left: [], right: [] }, edit: { left: [], right: ["edit", "data"] } },
};
import "./insights.css";

type MenuGroup = { label?: string; widgetIds?: string[] };
// Our widgets join Studio's own in their own menu group. The image widget is left out: it loads
// any address it is given, which a prompt-injected analyst could use to send data off the page.
const widgets = (defaults: { menu: unknown[] }) =>
  createWidgets({
    additionalTypes: SELLER_DESK_WIDGETS,
    menu: [
      ...(defaults.menu as MenuGroup[]).map((group) => (group.widgetIds ? { ...group, widgetIds: group.widgetIds.filter((id) => id !== "image") } : group)),
      { label: "Seller Desk", widgetIds: SELLER_DESK_WIDGETS.map((widget) => (widget as unknown as { id: string }).id) }],
  } as never);

/**
 * The owner's Insights dashboard: AG Studio over the shop's own orders, conversations and offers.
 * Our tabs choose the page; Edit lets the owner rearrange or add widgets for this visit.
 */
export function InsightsStudio({ data, licenseKey }: { data: InsightsData; licenseKey?: string }) {
  const api = useRef<AgStudioApi | null>(null);
  const [page, setPage] = useState<string>(insightsReport.selectedPageId ?? INSIGHT_PAGES[0].id);
  const [panel, setPanel] = useState<Panel>("none");
  // Follows the live report: an agent can add widgets or switch pages, and the canvas grows to fit.
  const [heights, setHeights] = useState<Record<string, { wide: number; phone: number }>>(() =>
    Object.fromEntries(INSIGHT_PAGES.map((item) => [item.id, { wide: item.height, phone: item.phoneHeight }])),
  );
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${PHONE_WIDTH}px)`);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const sources = useMemo(() => studioData(data), [data]);

  const open = (id: string) => {
    setPage(id);
    const current = api.current?.getState();
    if (current) api.current?.setState({ ...current, selectedPageId: id } as AgReportState);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-6 pb-4 sm:px-8">
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPanel(panel === "analyst" ? "none" : "analyst")}
            aria-pressed={panel === "analyst"}
            className="bg-brand hover:bg-brand-strong rounded-[var(--radius-control)] px-3.5 py-1.5 text-[14px] font-medium text-white"
          >
            {panel === "analyst" ? "Close analyst" : "Ask the analyst"}
          </button>
          <button
            type="button"
            onClick={() => setPanel(panel === "edit" ? "none" : "edit")}
            aria-pressed={panel === "edit"}
            className="border-line-strong hover:bg-sunken rounded-[var(--radius-control)] border px-3.5 py-1.5 text-[14px] font-medium"
          >
            {panel === "edit" ? "Done editing" : "Edit dashboard"}
          </button>
        </div>
      </div>
      <div className="insights-canvas mx-2 flex-none sm:mx-6" style={{ height: Math.max((phone ? heights[page]?.phone : heights[page]?.wide) ?? 900, panel === "none" ? 0 : 760) }}>
        <AgStudioProvider licenseKey={licenseKey} modules={MODULES}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={deskStudioTheme}
            layout={{ widgetBorderEnabled: true }}
            // Reading shows no side panel; the analyst opens its chat; editing adds the widget and data panels.
            panels={PANELS[panel]}
            responsiveLayoutBreakpoints={BREAKPOINTS}
            data={sources}
            widgets={widgets as never}
            initialState={insightsReport}
            mode={panel === "none" ? "view" : "edit"}
            ai={({ api: studio }) => createAiHarness(studio as AgStudioApi, { adapter: sellerDeskAdapter(), promptStarters: STARTERS })}
            onStateUpdated={(event) => {
              const next = Object.fromEntries(event.state.pages.map((item) => [item.id, { wide: pageHeight(item), phone: phonePageHeight(item) }]));
              setHeights((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
              if (event.state.selectedPageId && event.state.selectedPageId !== page) setPage(event.state.selectedPageId);
            }}
            onApiReady={(event) => {
              api.current = event.api;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
