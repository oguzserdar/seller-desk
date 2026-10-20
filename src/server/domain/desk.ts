/**
 * The owner desk query. One closed filter schema serves the grid, the filter
 * buttons and the owner assistant, so an AI answer can always be checked
 * against the same rows a person sees. Totals are computed here, per currency.
 */
import { formatMoney } from "@/lib/money";
import { getDb } from "@/server/db/client";
import {
  fulfillmentTask,
  offer,
  orderFollowup,
  orders,
  paymentAttempt,
  quote,
} from "@/server/db/schema";
import type { OfferKind } from "@/server/db/types";
import { getStorage } from "@/server/storage";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { projectOrders, projectPayments, projectQuotes } from "./desk-view";
import { getDigitalAccessBlocks } from "./digital";
import { type TaskType } from "./orders";
import type { OwnerPrincipal } from "./principal";

export const DESK_VIEWS = [
  "needs_attention",
  "all_orders",
  "pickup_pending",
  "service_followup",
  "access_failed",
  "completed",
  "payments_uncertain",
  "quotes_awaiting_review",
] as const;
export type DeskView = (typeof DESK_VIEWS)[number];

export const DESK_VIEW_LABEL: Record<DeskView, string> = {
  needs_attention: "Needs you",
  all_orders: "All orders",
  pickup_pending: "Pickups to hand over",
  service_followup: "Service work to finish",
  access_failed: "Downloads not opened",
  completed: "Fulfilled",
  payments_uncertain: "Payments to check",
  quotes_awaiting_review: "Quotes to review",
};

export const DeskFilter = z
  .object({
    view: z.enum(DESK_VIEWS).default("needs_attention"),
    kind: z.enum(["goods", "service", "digital"]).optional(),
    search: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export type DeskFilter = z.input<typeof DeskFilter>;

export type DeskTask = {
  id: string;
  type: TaskType;
  state: string;
  revision: number;
  label: string;
  tone: "action" | "success" | "attention";
};

export type DeskRow = {
  kind: "order" | "payment" | "quote";
  id: string;
  ref: string;
  when: string;
  who: string;
  items: string;
  offerKinds: OfferKind[];
  /** The first item's offer and its photo, for the row thumbnail. */
  firstOfferId: string | null;
  imagePath: string | null;
  totalMinor: number | null;
  currency: string;
  amount: string;
  status: string;
  nextStep: string;
  /** Verified permanent access issue, when this paid order has one. */
  accessReview?: string;
  tone: "action" | "success" | "attention" | "neutral";
  needsOwner: boolean;
  environment: "fixture" | "sandbox";
  tasks: DeskTask[];
  href: string;
};

export type DeskResult = {
  view: DeskView;
  rows: DeskRow[];
  totals: {
    currency: string;
    paidOrders: number;
    paidMinor: number;
    paidLabel: string;
  }[];
  counts: Record<DeskView, number>;
};

async function orderRows(owner: OwnerPrincipal): Promise<DeskRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.sellerId, owner.sellerId))
    .orderBy(desc(orders.paidAt))
    .limit(500);
  if (rows.length === 0) return [];
  const tasks = await db
    .select()
    .from(fulfillmentTask)
    .where(
      inArray(
        fulfillmentTask.orderId,
        rows.map((row) => row.id),
      ),
    );
  const accessBlocks = await getDigitalAccessBlocks(rows);
  const followups = await db
    .selectDistinctOn([orderFollowup.orderId])
    .from(orderFollowup)
    .where(
      inArray(
        orderFollowup.orderId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(orderFollowup.orderId, desc(orderFollowup.revision));
  return projectOrders(rows, tasks, followups, accessBlocks);
}

async function paymentRows(owner: OwnerPrincipal): Promise<DeskRow[]> {
  const rows = await getDb()
    .select({ attempt: paymentAttempt, lines: quote.lines })
    .from(paymentAttempt)
    .innerJoin(quote, eq(quote.id, paymentAttempt.quoteId))
    .where(
      and(
        eq(paymentAttempt.sellerId, owner.sellerId),
        inArray(paymentAttempt.state, [
          "create_in_flight",
          "approval_observed",
          "capture_in_flight",
          "verification_pending",
        ]),
        isNotNull(paymentAttempt.lastError),
      ),
    )
    .orderBy(desc(paymentAttempt.updatedAt))
    .limit(200);
  return projectPayments(rows);
}

async function quoteRows(owner: OwnerPrincipal): Promise<DeskRow[]> {
  const rows = await getDb()
    .select()
    .from(quote)
    .where(
      and(
        eq(quote.sellerId, owner.sellerId),
        eq(quote.status, "seller_review"),
      ),
    )
    .orderBy(desc(quote.createdAt))
    .limit(200);
  return projectQuotes(rows);
}

function matchesView(row: DeskRow, view: DeskView): boolean {
  const openTask = (type: DeskTask["type"], states: string[]) =>
    row.tasks.some((task) => task.type === type && states.includes(task.state));
  switch (view) {
    case "needs_attention":
      return row.needsOwner;
    case "all_orders":
      return row.kind === "order";
    case "pickup_pending":
      return (
        row.kind === "order" &&
        openTask("pickup", ["pending", "in_progress", "attention"])
      );
    case "service_followup":
      return (
        row.kind === "order" &&
        (openTask("service_followup", ["pending", "in_progress"]) ||
          openTask("service_work", ["pending", "in_progress", "attention"]))
      );
    case "access_failed":
      return (
        row.kind === "order" &&
        openTask("digital_access", ["attention", "pending"])
      );
    case "completed":
      return (
        row.kind === "order" &&
        row.tasks.length > 0 &&
        row.tasks.every((task) => task.state === "completed")
      );
    case "payments_uncertain":
      return row.kind === "payment";
    case "quotes_awaiting_review":
      return row.kind === "quote";
  }
}

/** Runs a closed desk filter for the owner. Never accepts free-form queries. */
export async function queryDesk(
  owner: OwnerPrincipal,
  raw: DeskFilter,
): Promise<DeskResult> {
  const filter = DeskFilter.parse(raw);
  const backend = getStorage();
  const [orderList, paymentList, quoteList] =
    backend.kind === "d1"
      ? await backend.desk.rows(owner)
      : await Promise.all([
          orderRows(owner),
          paymentRows(owner),
          quoteRows(owner),
        ]);
  const all = [...quoteList, ...paymentList, ...orderList];
  const offerIds = [
    ...new Set(
      all
        .map((row) => row.firstOfferId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const images = offerIds.length
    ? backend.kind === "d1"
      ? await backend.desk.images(owner, offerIds)
      : await getDb()
          .select({ id: offer.id, imagePath: offer.imagePath })
          .from(offer)
          .where(
            and(
              inArray(offer.id, offerIds),
              eq(offer.sellerId, owner.sellerId),
            ),
          )
    : [];
  const imageBy = new Map(images.map((image) => [image.id, image.imagePath]));
  for (const row of all)
    row.imagePath = row.firstOfferId
      ? (imageBy.get(row.firstOfferId) ?? null)
      : null;
  const search = filter.search?.toLowerCase();
  const scoped = all.filter(
    (row) =>
      (!filter.kind || row.offerKinds.includes(filter.kind)) &&
      (!search ||
        `${row.ref} ${row.who} ${row.items}`.toLowerCase().includes(search)),
  );
  const counts = Object.fromEntries(
    DESK_VIEWS.map((view) => [
      view,
      scoped.filter((row) => matchesView(row, view)).length,
    ]),
  ) as Record<DeskView, number>;
  const rows = scoped
    .filter((row) => matchesView(row, filter.view))
    .slice(0, filter.limit);
  const byCurrency = new Map<
    string,
    { paidOrders: number; paidMinor: number }
  >();
  for (const row of rows.filter((r) => r.kind === "order")) {
    const entry = byCurrency.get(row.currency) ?? {
      paidOrders: 0,
      paidMinor: 0,
    };
    entry.paidOrders += 1;
    if (row.totalMinor === null) throw new Error("Paid order has no total");
    entry.paidMinor += row.totalMinor;
    byCurrency.set(row.currency, entry);
  }
  const totals = [...byCurrency.entries()].map(([currency, entry]) => ({
    currency,
    ...entry,
    paidLabel: formatMoney(entry.paidMinor, currency),
  }));
  return { view: filter.view, rows, totals, counts };
}

/** Rows touched by an id (assistant read-back): exact ids only, scoped to the owner. */
export async function findDeskRowsByIds(
  owner: OwnerPrincipal,
  ids: string[],
): Promise<DeskRow[]> {
  const result = await queryDesk(owner, { view: "all_orders", limit: 200 });
  const extra = await queryDesk(owner, { view: "needs_attention", limit: 200 });
  const all = new Map(
    [...result.rows, ...extra.rows].map((row) => [row.id, row]),
  );
  return ids
    .map((id) => all.get(id))
    .filter((row): row is DeskRow => Boolean(row));
}
