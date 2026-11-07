/**
 * What an AI app connected to the desk can and cannot do, in the owner's words. The consent page
 * and Setup both show these lists, so the promise an app is approved under and the one Setup
 * repeats are the same text. The tools in src/server/connector/tools.ts are read-only.
 */

/** What a connected AI app can do. */
export const CONNECTOR_CAN = [
  "See buyers and questions waiting for you",
  "Read conversations, orders and your offers",
] as const;

/** What a connected AI app can never do. */
export const CONNECTOR_CANNOT = ["Message a buyer", "Change prices, stock or orders", "Refund or take payments"] as const;
