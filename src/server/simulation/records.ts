import type { SimulationSideResult } from "@/lib/simulation";
import { getDb } from "@/server/db/client";
import { getRequestScope } from "@/server/request-scope";
import { sql } from "drizzle-orm";

/** Independent counts from the active isolated database, after all actual effects. */
export async function readSimulationRecords(): Promise<
  SimulationSideResult["records"]
> {
  const native = getRequestScope()?.d1;
  if (native)
    return (await native.get<SimulationSideResult["records"]>(
      sql`select (select count(*) from quote) as quotes,(select count(*) from orders) as "paidOrders",(select count(*) from fixture_provider_order where capture_id is not null) as captures,(select count(*) from fulfillment_task where state<>'completed') as "pendingTasks",(select count(*) from fulfillment_task where state='completed') as "completedTasks",(select count(*) from seller_question where state='open') as "openSellerQuestions"`,
    ))!;
  const counted = await getDb().execute<
    SimulationSideResult["records"]
  >(sql`select
    (select count(*)::int from quote) as quotes,
    (select count(*)::int from orders) as "paidOrders",
    (select count(*)::int from fixture_provider_order where capture_id is not null) as captures,
    (select count(*)::int from fulfillment_task where state <> 'completed') as "pendingTasks",
    (select count(*)::int from fulfillment_task where state = 'completed') as "completedTasks",
    (select count(*)::int from seller_question where state = 'open') as "openSellerQuestions"`);
  return counted.rows[0]!;
}
