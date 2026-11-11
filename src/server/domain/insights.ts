/**
 * The rows behind the owner's Insights dashboard, read through the same owner-scoped functions the
 * desk pages use. Plain, serialisable rows: the dashboard joins and sums them in the browser.
 */
import { queryDesk } from "@/server/domain/desk";
import { listSellerConversations } from "@/server/domain/conversation-messages";
import { listOwnerOffers } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { openQuestions } from "@/server/domain/seller-questions";

const KIND_LABEL = { goods: "Pickup item", service: "Service", digital: "Download" } as const;

/** One paid order: money in major units, so sums read as dollars. */
export type InsightOrder = { id: string; ref: string; date: string; product: string; kind: string; amount: number; currency: string; nextStep: string; needsYou: string };
/** One customer conversation and who is handling it. */
export type InsightConversation = { id: string; date: string; handledBy: string; waitingForYou: string; topic: string };
/** One offer and how it is selling. */
export type InsightOffer = { id: string; title: string; kind: string; price: number | null; inStock: number | null; sold: number };

/** Everything the dashboard reads, as of one moment. */
export type InsightsData = { asOf: string; currency: string; orders: InsightOrder[]; conversations: InsightConversation[]; offers: InsightOffer[] };

/**
 * Loads the owner's orders, conversations and offers for the dashboard.
 *
 * @param owner - The signed-in owner, or a demo visitor reading as the owner
 * @returns Rows bounded to the desk's recent window (200 orders, 50 conversations)
 */
export async function loadInsights(owner: OwnerPrincipal): Promise<InsightsData> {
  const [desk, conversations, offers, waiting] = await Promise.all([
    queryDesk(owner, { view: "all_orders", limit: 200 }),
    listSellerConversations(owner),
    listOwnerOffers(owner),
    openQuestions(owner),
  ]);
  const waitingIds = new Set(waiting.map((question) => question.conversationId));
  const orders: InsightOrder[] = desk.rows
    .filter((row) => row.kind === "order" && row.totalMinor !== null)
    .map((row) => ({
      id: row.id,
      ref: row.ref,
      date: new Date(row.when).toISOString(),
      product: row.items,
      kind: KIND_LABEL[row.offerKinds[0] ?? "goods"],
      amount: row.totalMinor! / 100,
      currency: row.currency,
      nextStep: row.nextStep,
      needsYou: row.needsOwner ? "Needs you" : "Done",
    }));
  return {
    asOf: new Date().toISOString(),
    currency: orders[0]?.currency ?? "USD",
    orders,
    conversations: conversations.map((item) => ({
      id: item.id,
      date: new Date(item.updatedAt).toISOString(),
      handledBy: item.handler === "seller" ? "You" : "Assistant",
      waitingForYou: waitingIds.has(item.id) ? "Waiting for you" : "Answered",
      topic: (item.preview ?? "").slice(0, 120) || "Customer conversation",
    })),
    offers: offers.map(({ row, stock }) => ({
      id: row.id,
      title: row.title,
      kind: KIND_LABEL[row.kind as keyof typeof KIND_LABEL] ?? row.kind,
      price: row.unitAmountMinor === null ? null : row.unitAmountMinor / 100,
      inStock: stock ? stock.total - stock.held - stock.sold : null,
      sold: stock?.sold ?? orders.filter((order) => order.product === row.title).length,
    })),
  };
}
