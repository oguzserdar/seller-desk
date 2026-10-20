import { getStorage } from "@/server/storage";
/** Whole-shop operating facts; recorded completion and customer-confirmed resolution stay separate. */
import { getDb } from "@/server/db/client";
import { getServerConfig } from "@/server/env";
import { sql } from "drizzle-orm";
import { notFound } from "./errors";
import type { OwnerPrincipal } from "./principal";

/** Counts from one authorized database snapshot, without row-list limits or customer details. */
export type WorkCounts = {
  paidOrders: number;
  ordersRecordedFulfilled: number;
  ordersWithUnfinishedTasks: number;
  ordersMissingTasks: number;
  paymentsAwaitingConfirmation: number;
  problemsNeedingSeller: number;
  problemsWaitingForCustomer: number;
  problemsConfirmedByCustomer: number;
  sellerQuestionsOpen: number;
  sellerAnswersSaved: number;
  publicFactsAvailable: number;
};

/**
 * Reads current all-history counts as the authenticated shop owner. A single
 * statement proves ownership and observes mutually consistent record states.
 * Reopened problems replace earlier confirmations; joins never multiply orders.
 * No conversion, recovered-payment, time-saving or AI-resolution metric is inferred.
 */
export async function readWorkSummary(owner: OwnerPrincipal) {
  const backend = getStorage();
  const result =
    backend.kind === "d1"
      ? { rows: [await backend.reports.workRow(owner)] }
      : await getDb().execute<WorkCounts & { asOf: string }>(sql`
    with owned_shop as (
      select id from seller where id = ${owner.sellerId} and owner_user_id = ${owner.userId}
    ), owned_orders as (
      select o.id from orders o join owned_shop s on s.id = o.seller_id
      where o.paid_at <= statement_timestamp()
    ), task_counts as (
      select o.id, count(t.id) as total,
        count(t.id) filter (where t.state <> 'completed') as unfinished
      from owned_orders o left join fulfillment_task t on t.order_id = o.id group by o.id
    ), latest_problems as (
      select distinct on (f.order_id) f.order_id, f.state
      from order_followup f join owned_orders o on o.id = f.order_id
      order by f.order_id, f.revision desc
    )
    select statement_timestamp() as "asOf",
      (select count(*)::int from owned_orders) as "paidOrders",
      (select count(*)::int from task_counts where total > 0 and unfinished = 0) as "ordersRecordedFulfilled",
      (select count(*)::int from task_counts where unfinished > 0) as "ordersWithUnfinishedTasks",
      (select count(*)::int from task_counts where total = 0) as "ordersMissingTasks",
      (select count(*)::int from payment_attempt p where p.seller_id = s.id
        and p.state in ('planned','create_in_flight','order_created','approval_observed','capture_in_flight','verification_pending')) as "paymentsAwaitingConfirmation",
      (select count(*)::int from latest_problems where state = 'needs_help') as "problemsNeedingSeller",
      (select count(*)::int from latest_problems where state = 'awaiting_customer') as "problemsWaitingForCustomer",
      (select count(*)::int from latest_problems where state = 'confirmed') as "problemsConfirmedByCustomer",
      (select count(*)::int from seller_question q where q.seller_id = s.id and q.state = 'open') as "sellerQuestionsOpen",
      (select count(*)::int from seller_question q where q.seller_id = s.id and q.answer is not null) as "sellerAnswersSaved",
      (select count(*)::int from shop_guide g where g.seller_id = s.id and g.published and not g.archived
        and (g.valid_until is null or g.valid_until > statement_timestamp())
        and (g.product_id is null or exists (select 1 from offer p where p.id = g.product_id and p.seller_id = s.id and p.published))) as "publicFactsAvailable"
    from owned_shop s
  `);
  const row = result.rows[0];
  if (!row) throw notFound("shop");
  const { asOf, ...counts } = row;
  return {
    asOf: new Date(asOf).toISOString(),
    environment: getServerConfig().mode,
    scope:
      "Current state across this shop's recorded history; no display-row limit.",
    counts,
    definitions: {
      ordersRecordedFulfilled:
        "At least one fulfillment task exists and all recorded tasks are complete. Not proof of customer satisfaction, file opening or service acceptance.",
      problemsConfirmedByCustomer:
        "Orders whose latest help record is an explicit buyer confirmation. Reopened problems are excluded. A resolved question does not mean all purchased work is complete.",
      paymentsAwaitingConfirmation:
        "Includes checkouts still waiting for buyer approval as well as processing or uncertain payments. Not all require seller action.",
      sellerAnswersSaved:
        "Seller answers saved in this installation, not proof they were delivered, read or resolved the customer's issue.",
      publicFactsAvailable:
        "Currently published, unexpired knowledge entries with an available product scope. Not a measure of use or avoided questions.",
    },
    notMeasured: [
      "AI-attributed resolutions",
      "customer satisfaction rate",
      "conversion lift",
      "time or money saved",
      "recovered-payment count",
    ],
  };
}
