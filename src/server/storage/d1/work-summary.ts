import { nowMilliseconds } from "@/server/db/sqlite/columns";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import type { WorkCounts } from "@/server/domain/work-summary";
import { sql } from "drizzle-orm";
import type { D1Db } from "./client";

/** One native D1 statement proves ownership and observes whole-shop operating counts coherently. */
export async function readD1WorkRow(
  db: D1Db,
  owner: OwnerPrincipal,
): Promise<WorkCounts & { asOf: string }> {
  const row = await db.get<WorkCounts & { asOf: string }>(sql`
    with owned_shop as (select id from seller where id=${owner.sellerId} and owner_user_id=${owner.userId}),
    owned_orders as (select o.id from orders o join owned_shop s on s.id=o.seller_id where o.paid_at<=${nowMilliseconds}),
    task_counts as (select o.id,count(t.id) total,count(t.id) filter(where t.state<>'completed') unfinished from owned_orders o left join fulfillment_task t on t.order_id=o.id group by o.id),
    latest_problems as (select f.order_id,f.state from order_followup f join owned_orders o on o.id=f.order_id where f.revision=(select max(later.revision) from order_followup later where later.order_id=f.order_id))
    select strftime('%Y-%m-%dT%H:%M:%fZ','now') as "asOf",
      (select count(*) from owned_orders) as "paidOrders",
      (select count(*) from task_counts where total>0 and unfinished=0) as "ordersRecordedFulfilled",
      (select count(*) from task_counts where unfinished>0) as "ordersWithUnfinishedTasks",
      (select count(*) from task_counts where total=0) as "ordersMissingTasks",
      (select count(*) from payment_attempt p where p.seller_id=s.id and p.state in ('planned','create_in_flight','order_created','approval_observed','capture_in_flight','verification_pending')) as "paymentsAwaitingConfirmation",
      (select count(*) from latest_problems where state='needs_help') as "problemsNeedingSeller",
      (select count(*) from latest_problems where state='awaiting_customer') as "problemsWaitingForCustomer",
      (select count(*) from latest_problems where state='confirmed') as "problemsConfirmedByCustomer",
      (select count(*) from seller_question q where q.seller_id=s.id and q.state='open') as "sellerQuestionsOpen",
      (select count(*) from seller_question q where q.seller_id=s.id and q.answer is not null) as "sellerAnswersSaved",
      (select count(*) from shop_guide g where g.seller_id=s.id and g.published=1 and g.archived=0 and (g.valid_until is null or g.valid_until>${nowMilliseconds}) and (g.product_id is null or exists(select 1 from offer p where p.id=g.product_id and p.seller_id=s.id and p.published=1))) as "publicFactsAvailable"
    from owned_shop s`);
  if (!row) throw notFound("shop");
  return row;
}
