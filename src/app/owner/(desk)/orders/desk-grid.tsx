"use client";

import {
  AllCommunityModule,
  type ColDef,
  type GridApi,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { OfferPhoto } from "@/components/buyer/offer-tile";
import { cx } from "@/lib/cx";
import { Button } from "@/components/arc/button/button";
import { SearchField } from "@/components/arc/search-field/search-field";
import { neutralizeCell } from "@/lib/spreadsheet";
import type { DeskRow } from "@/server/domain/desk";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 15,
  headerFontSize: 13,
  headerFontWeight: 500,
  // Theme tokens, so the grid follows the owner's chosen desk theme.
  accentColor: "var(--color-brand)",
  foregroundColor: "var(--color-ink)",
  backgroundColor: "var(--color-surface)",
  headerBackgroundColor: "var(--color-surface)",
  headerTextColor: "var(--color-ink-2)",
  borderColor: "var(--color-line)",
  rowBorder: { color: "var(--color-line)" },
  columnBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "transparent",
  rowHoverColor: "var(--color-sunken)",
  wrapperBorderRadius: 14,
  rowHeight: 68,
  // One row tall: a one-order desk should not sit above an empty band.
  autoHeightMinBodyHeight: 68,
  headerHeight: 44,
  spacing: 8,
  cellHorizontalPadding: 12,
});

/** The next step in words; an amber dot marks work that waits on the owner. */
function NextStep({ row }: { row: DeskRow }) {
  return (
    <span className="flex h-full items-center gap-2 leading-snug whitespace-normal">
      {row.needsOwner ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-attention"
        />
      ) : null}
      <span className={row.needsOwner ? "text-ink" : "text-ink-3"}>
        {row.nextStep}
      </span>
    </span>
  );
}

function ItemCell({ data }: { data?: DeskRow }) {
  if (!data) return null;
  return (
    <span className="flex h-full items-center gap-3">
      <OfferPhoto
        offer={{ title: data.items, imagePath: data.imagePath, kind: data.offerKinds[0] }}
        sizes="48px"
        className="size-12 shrink-0 rounded-[9px]"
      />
      <span className="truncate">{data.items}</span>
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export function DeskGrid({
  rows,
  viewLabel,
}: {
  rows: DeskRow[];
  viewLabel: string;
}) {
  const router = useRouter();
  const gridApi = useRef<GridApi<DeskRow> | null>(null);
  const [search, setSearch] = useState("");

  const columns = useMemo<ColDef<DeskRow>[]>(
    () => [
      {
        field: "ref",
        headerName: "Order",
        width: 92,
        tooltipField: "ref",
        // A real link, so the cell is announced as a link to the order. The grid moves keyboard focus cell by
        // cell, and Enter on a focused cell opens the order (onCellKeyDown); the row click stays for pointer users.
        cellRenderer: ({ data }: { data?: DeskRow }) =>
          data ? (
            <Link
              href={data.href}
              onClick={(event) => event.stopPropagation()}
              className="font-semibold hover:underline"
            >
              {data.ref}
            </Link>
          ) : null,
      },
      {
        field: "items",
        headerName: "Item",
        flex: 1.3,
        minWidth: 240,
        cellRenderer: ItemCell,
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 92,
        comparator: (_a, _b, nodeA, nodeB) =>
          (nodeA.data?.totalMinor ?? 0) - (nodeB.data?.totalMinor ?? 0),
        cellClass: "tabular",
      },
      // Wraps to a second line rather than cutting the instruction off mid-word.
      {
        field: "nextStep",
        headerName: "Next step",
        flex: 1,
        minWidth: 205,
        wrapText: true,
        cellRenderer: ({ data }: { data?: DeskRow }) =>
          data ? <NextStep row={data} /> : null,
      },
      // Kept for the CSV export; the buyer name lives on the order page.
      { field: "who", headerName: "Customer", hide: true },
      // The payment state in words with a mark, so a paid row never relies on colour alone.
      {
        field: "status",
        headerName: "Payment",
        width: 150,
        cellRenderer: ({ data }: { data?: DeskRow }) =>
          data ? (
            <span className="flex h-full items-center">
              <span
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] leading-none font-medium",
                  data.status === "Paid" ? "bg-success-soft text-success" : "bg-sunken text-ink-2",
                )}
              >
                {data.status === "Paid" ? <span aria-hidden>✓</span> : null}
                {data.status}
              </span>
            </span>
          ) : null,
      },
      {
        field: "when",
        headerName: "When",
        width: 100,
        sort: "desc",
        cellClass: "text-ink-3 tabular",
        valueFormatter: (p) =>
          p.value ? shortDate.format(new Date(p.value as string)) : "",
        tooltipValueGetter: (p) =>
          p.value ? dateFormat.format(new Date(p.value as string)) : "",
      },
    ],
    [],
  );

  const exportCsv = () => {
    gridApi.current?.exportDataAsCsv({
      fileName: `seller-desk-${viewLabel.toLowerCase().replace(/\s+/g, "-")}.csv`,
      columnKeys: [
        "ref",
        "when",
        "who",
        "items",
        "amount",
        "status",
        "nextStep",
      ],
      processCellCallback: (params) => neutralizeCell(params.value),
    });
  };

  const filtered = rows.filter(
    (row) =>
      !search ||
      `${row.ref} ${row.who} ${row.items} ${row.nextStep}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  if (rows.length === 0)
    return (
      <div className="surface px-6 py-10">
        <h3 className="text-[17px] font-semibold">
          {viewLabel === "All orders"
            ? "No orders yet"
            : "Nothing in this view"}
        </h3>
        <p className="text-ink-2 mt-2 max-w-md text-[14px]">
          {viewLabel === "All orders"
            ? "New purchases appear here with payment status and the work still owed."
            : "Choose another view to see the rest of your orders."}
        </p>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-[14px] font-medium">
          <Link
            href="/buy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Open customer shop ↗
          </Link>
          <Link
            href="/owner/offers"
            className="text-ink-2 underline underline-offset-4"
          >
            Review offers
          </Link>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:max-w-xs">
          <SearchField
            label="Search this view"
            id="desk-search"
            placeholder="Order, customer or item"
            value={search}
            onValueChange={setSearch}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="hidden lg:inline-flex"
        >
          Export CSV
        </Button>
      </div>

      <div className="hidden lg:block">
        <AgGridReact<DeskRow>
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => `${params.data.kind}:${params.data.id}`}
          quickFilterText={search}
          domLayout="autoHeight"
          onGridReady={(event) => {
            gridApi.current = event.api;
          }}
          onRowClicked={(event) => {
            if (event.data) router.push(event.data.href);
          }}
          onCellKeyDown={(event) => {
            const key = (event.event as KeyboardEvent | undefined)?.key;
            if (key === "Enter" && event.data) router.push(event.data.href);
          }}
          overlayNoRowsTemplate="<span>Nothing here right now.</span>"
          rowClass="cursor-pointer"
        />
      </div>

      <ul className="flex flex-col gap-2 lg:hidden" aria-label={viewLabel}>
        {filtered.length === 0 ? (
          <li className="text-ink-3 py-6 text-center">
            Nothing here right now.
          </li>
        ) : null}
        {filtered.map((row) => (
          <li key={`${row.kind}:${row.id}`}>
            <Link
              href={row.href}
              className={cx(
                "bg-surface border-line flex gap-3 rounded-[12px] border p-3 transition-transform duration-150 ease-out active:scale-[0.99]",
              )}
            >
              <OfferPhoto
                offer={{ title: row.items, imagePath: row.imagePath }}
                sizes="56px"
                className="size-14 shrink-0 rounded-[10px]"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{row.ref}</span>
                  <span className="tabular font-semibold">{row.amount}</span>
                </span>
                <span className="text-ink-2 truncate text-[14px]">
                  {row.items}
                </span>
                <span className="text-[14px]">
                  <NextStep row={row} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
