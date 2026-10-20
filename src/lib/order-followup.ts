import { z } from "zod";

const version = { orderId: z.uuid(), expectedRevision: z.number().int().min(0).max(1_000_000) };

/** Explicit buyer feedback on one paid order; no payment, fulfillment or waiver instructions. */
export const BuyerOrderFollowupInput = z.discriminatedUnion("action", [
  z.object({ ...version, action: z.literal("help"), message: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ ...version, action: z.literal("confirm") }).strict(),
]);
/** The exact problem version the authenticated seller is answering. */
export const ReplyOrderFollowupInput = z.object({ ...version, message: z.string().trim().min(3).max(1000) }).strict();

/** Customer-visible order help, separate from delivery and payment. */
export type OrderFollowupView = {
  state: "none" | "needs_help" | "awaiting_customer" | "confirmed";
  revision: number;
  nextActor: "seller" | "buyer" | null;
  history: { revision: number; actor: "buyer" | "owner"; state: "needs_help" | "awaiting_customer" | "confirmed"; message: string; at: string }[];
  earlierMessages: boolean;
};

/** Status text refers only to the reported problem, never acceptance of work or a waiver. */
export const ORDER_FOLLOWUP_LABEL: Record<OrderFollowupView["state"], string> = {
  none: "Need help with this order?",
  needs_help: "Waiting for the shop",
  awaiting_customer: "The shop replied",
  confirmed: "You confirmed this problem is resolved",
};
