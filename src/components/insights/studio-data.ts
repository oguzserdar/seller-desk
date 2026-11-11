/**
 * The Insights dashboard's data model for AG Studio: orders, conversations and offers as tables,
 * a shared calendar, and the measures an owner asks about first.
 */
import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { InsightsData } from "@/server/domain/insights";

export const CALENDAR = "calendar";

type Field = [id: string, name: string, format: AgFormat, hidden?: boolean];

/**
 * Field definitions; money fields show the shop's currency symbol.
 *
 * @param currency - The shop's currency code
 */
const fieldsIn = (currency: string) => (list: Field[]): AgFieldDefinition[] =>
  list.map(([id, name, format, hidden]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat"
      ? { formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }) } }
      : {}),
    ...(hidden ? { hide: true } : {}),
  }));

/** Each conversation counts once; the flags make "share handled by the assistant" a plain ratio. */
function conversationRows(data: InsightsData) {
  return data.conversations.map((row) => ({
    ...row,
    date: wallClock(row.date),
    one: 1,
    // Answered by the assistant means it needed nobody: not taken over, and not waiting on the owner.
    byAssistant: row.handledBy === "Assistant" && row.waitingForYou !== "Waiting for you" ? 1 : 0,
    waiting: row.waitingForYou === "Waiting for you" ? 1 : 0,
  }));
}

/**
 * Builds the tables, relations and measures Studio reads.
 *
 * @param data - The owner's rows from the server
 * @returns Studio's data sources definition
 */
export function studioData(data: InsightsData): AgDataSourcesDefinition {
  // Studio buckets by the date it is given; hand it the viewer's own wall-clock time, so an
  // evening order lands on today, not on tomorrow in UTC.
  const orders = data.orders.map((row) => ({ ...row, date: wallClock(row.date) }));
  const dates = [...orders, ...data.conversations.map((row) => ({ date: wallClock(row.date) }))].map((row) => row.date.slice(0, 10)).sort();
  const today = wallClock(data.asOf).slice(0, 10);
  const fields = fieldsIn(data.currency);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency });
  return {
    description:
      `A small shop's sales desk. Seller Desk's AI assistant answers customers, builds quotes and takes payment through PayPal; ` +
      `the owner answers what it cannot know. Money is in ${data.currency}. Orders are paid orders only: PayPal confirmed each one.`,
    sources: [
      {
        id: "orders",
        name: "Paid orders",
        description: "One row per paid order. Amount is what the customer paid through PayPal.",
        data: orders,
        fields: fields([
          ["id", "Order ID", "textFormat", true],
          ["ref", "Order", "textFormat"],
          ["date", "Paid at", "dateTimeFormat"],
          ["product", "Product", "textFormat"],
          ["kind", "Kind", "textFormat"],
          ["amount", "Revenue", "currencyFormat"],
          ["currency", "Currency", "textFormat", true],
          ["nextStep", "Next step", "textFormat"],
          ["needsYou", "Status", "textFormat"],
        ]),
      },
      {
        id: "conversations",
        name: "Conversations",
        description: "Customer conversations, the most recent 50. Handled by says whether the assistant or the owner is answering.",
        data: conversationRows(data),
        fields: fields([
          ["id", "Conversation ID", "textFormat", true],
          ["customer", "Customer", "textFormat"],
          ["date", "Last message", "dateTimeFormat"],
          ["handledBy", "Handled by", "textFormat"],
          ["waitingForYou", "Waiting", "textFormat"],
          ["topic", "Question or latest message", "textFormat"],
          ["one", "Conversations", "integerFormat"],
          ["byAssistant", "Answered by the assistant", "integerFormat"],
          ["waiting", "Waiting for you", "integerFormat"],
        ]),
      },
      {
        id: "offers",
        name: "Offers",
        description: "The shop's catalog: price, stock left and units sold. A service without a price is quoted by the owner per job.",
        data: data.offers.map((offer) => ({ ...offer, priceLabel: offer.price === null ? "Quoted per job" : money.format(offer.price), stockLabel: offer.inStock === null ? "Not stocked" : String(offer.inStock) })),
        fields: fields([
          ["id", "Offer ID", "textFormat", true],
          ["title", "Offer", "textFormat"],
          ["kind", "Offer kind", "textFormat"],
          ["price", "Price", "currencyFormat", true],
          ["priceLabel", "Price", "textFormat"],
          ["inStock", "In stock", "integerFormat", true],
          ["stockLabel", "In stock", "textFormat"],
          ["sold", "Units sold", "integerFormat"],
        ]),
      },
      {
        // Only offers that have sold, so the chart is not padded with empty bars.
        id: "offerSales",
        name: "Offer sales",
        description: "Offers with at least one paid sale, and how many units sold.",
        data: data.offers.filter((offer) => offer.sold > 0).map(({ title, sold }) => ({ title, sold })),
        fields: fields([
          ["title", "Offer", "textFormat"],
          ["sold", "Units sold", "integerFormat"],
        ]),
      },
      {
        // Only physical goods carry stock; services and downloads never run out.
        id: "offerStock",
        name: "Stock",
        description: "Physical goods and how many are left to sell.",
        data: data.offers.flatMap((offer) => (offer.inStock === null ? [] : [{ title: offer.title, inStock: offer.inStock }])),
        fields: fields([
          ["title", "Offer", "textFormat"],
          ["inStock", "In stock", "integerFormat"],
        ]),
      },
    ],
    relationships: [
      { id: "orders-calendar", source: { tableId: "orders", fieldId: "date" }, target: { calendarId: CALENDAR }, truncate: "day" },
      { id: "conversations-calendar", source: { tableId: "conversations", fieldId: "date" }, target: { calendarId: CALENDAR }, truncate: "day" },
    ],
    calendars: [
      {
        id: CALENDAR,
        label: "Calendar",
        range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: today } },
        fragments: ["year", "quarter", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      {
        // A named measure, so tables say "Revenue" rather than "Revenue (sum)".
        id: "revenue",
        name: "Revenue",
        description: "Paid revenue through PayPal.",
        format: "currencyFormat",
        formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }) },
        isMeasure: true,
        expression: { operator: "coalesce", inputs: [{ id: "orders.amount", aggregation: "sum" }] },
      },
      // Named counts, so charts and legends say "Answered by the assistant", not "... (sum)".
      ...([
        ["conversationCount", "Conversations", "conversations.one", "Customer conversations."],
        ["answeredAlone", "Answered by the assistant", "conversations.byAssistant", "Conversations the assistant answered without needing the owner."],
        ["waitingCount", "Waiting for you", "conversations.waiting", "Conversations waiting for the owner's answer."],
      ] as const).map(([id, name, field, description]) => ({
        id,
        name,
        description,
        format: "integerFormat" as const,
        isMeasure: true,
        expression: { operator: "coalesce" as const, inputs: [{ id: field, aggregation: "sum" as const }] },
      })),
      {
        id: "assistantShare",
        name: "Handled by the assistant",
        description: "Share of conversations the assistant answered without needing the owner.",
        format: "percentageFormat",
        isMeasure: true,
        expression: { operator: "divide", inputs: [{ id: "conversations.byAssistant", aggregation: "sum" }, { id: "conversations.one", aggregation: "sum" }] },
      },
    ],
  };
}

/** An ISO timestamp as the viewer's local wall-clock time, without a zone (YYYY-MM-DDTHH:mm:ss). */
export function wallClock(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
