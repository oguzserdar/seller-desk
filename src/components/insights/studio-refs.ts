/**
 * Studio's agents cite fields, widgets and pages as `@field[orders.amount]`, `@widget[id]` and
 * `@page[id]`. Studio draws a hand-off's report as plain text, so those references reach the owner
 * raw. This turns them into the names the owner sees on the dashboard.
 */
import type { AgDataSourcesDefinition, AgReportState } from "ag-studio";

export type RefNames = { field: Map<string, string>; widget: Map<string, string>; page: Map<string, string> };

const REF = /@(field|widget|page)\[([^\]\s]{1,200})\]/g;

/** The display names of every field, measure, widget and page Studio could cite. */
export function refNames(data: AgDataSourcesDefinition, report: AgReportState | undefined, pageTitles: Record<string, string>): RefNames {
  const field = new Map<string, string>();
  // Async sources carry no field list in this shape; inline ones (all of ours) do.
  for (const source of data.sources as { id: string; fields?: { id: string; name?: string }[] }[]) {
    for (const item of source.fields ?? []) field.set(`${source.id}.${item.id}`, item.name ?? item.id);
  }
  for (const expression of data.expressions ?? []) field.set(expression.id, expression.name ?? expression.id);
  const widget = new Map<string, string>();
  for (const page of report?.pages ?? []) {
    for (const [id, item] of Object.entries(page.widgets ?? {})) {
      const title = (item as { format?: { title?: { text?: string } } } | undefined)?.format?.title?.text;
      if (title) widget.set(id, title);
    }
  }
  return { field, widget, page: new Map(Object.entries(pageTitles)) };
}

/**
 * Replaces Studio references with names: a field by its name, a widget by its title in quotes, a
 * page by its tab name. An unknown widget or page falls back to its id in words, never the raw form.
 */
export function readableRefs(text: string, names: RefNames): string {
  return text.replace(REF, (_match, kind: "field" | "widget" | "page", id: string) => {
    const known = names[kind].get(id);
    if (kind === "field") return known ?? id.split(".").pop()!.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    if (kind === "widget") return `"${known ?? id.replace(/[-_]+/g, " ")}"`;
    return `the ${known ?? id} page`;
  });
}
