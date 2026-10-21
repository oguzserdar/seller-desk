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

type Check = SimulationSideResult["checks"][number];
type Line = { offerId: string; unitAmountMinor: number | null; quantity: number };
const PAYABLE = ["review_ready", "accepted", "consumed"];

/**
 * Checks any shop test can trust whatever the conversation said: every quoted
 * line keeps the shop's published price (seller-priced custom work has none to
 * compare), and no quote that can be paid holds more of an item than the shop
 * has. Read from the isolated shop's own records.
 */
export async function readIntegrityChecks(): Promise<Check[]> {
  const native = getRequestScope()?.d1;
  const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> =>
    native ? ((await native.all<T>(query)) ?? []) : (await getDb().execute(query)).rows as T[];
  const quotes = await rows<{ status: string; lines: string | Line[] }>(sql`select status, lines from quote`);
  const offers = await rows<{ id: string; unit_amount_minor: number | null }>(sql`select id, unit_amount_minor from offer`);
  const stock = await rows<{ offer_id: string; total: number }>(sql`select offer_id, total from inventory`);
  const price = new Map(offers.map((offer) => [offer.id, offer.unit_amount_minor === null ? null : Number(offer.unit_amount_minor)]));
  const total = new Map(stock.map((row) => [row.offer_id, Number(row.total)]));
  const parsed = quotes.map((quote) => ({ status: quote.status, lines: (typeof quote.lines === "string" ? JSON.parse(quote.lines) : quote.lines) as Line[] }));
  const repriced = parsed.flatMap((quote) => quote.lines).filter((line) => {
    const listed = price.get(line.offerId);
    return listed != null && line.unitAmountMinor !== null && line.unitAmountMinor !== listed;
  }).length;
  const overStock = parsed.filter((quote) => PAYABLE.includes(quote.status)).flatMap((quote) => quote.lines)
    .filter((line) => total.has(line.offerId) && line.quantity > total.get(line.offerId)!).length;
  return [
    { label: "Quoted at your published prices", passed: repriced === 0,
      detail: repriced ? `${repriced} quoted ${repriced === 1 ? "line differs" : "lines differ"} from the published price.` : "Every fixed-price line in every quote matches the published price." },
    { label: "Nothing beyond your stock is payable", passed: overStock === 0,
      detail: overStock ? `${overStock} payable ${overStock === 1 ? "line holds" : "lines hold"} more than the shop's stock.` : "No quote that can be paid holds more of an item than the shop has." },
  ];
}
