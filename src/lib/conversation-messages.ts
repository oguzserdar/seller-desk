import type { UIMessage } from "ai";
import { z } from "zod";

/** Saved execution state for an unanswered customer message; never evidence of a business outcome. */
export type BuyerReplyState = "idle" | "answering" | "interrupted";

const SellerReply = z.object({ text: z.string(), sentAt: z.string(), answerPending: z.object({ id: z.uuid(), revision: z.number().int().positive() }).optional() });
/** Reads only the attributed human-message part created by the authenticated server action. */
export function sellerReplyOf(message: UIMessage): z.infer<typeof SellerReply> | null {
  const part = message.parts.find(part => part.type === "data-seller-reply");
  const parsed = SellerReply.safeParse(part && "data" in part ? part.data : null);
  return parsed.success ? parsed.data : null;
}

/** Plain conversation text for owner previews, without tool JSON or internal identifiers. */
export function conversationText(message: UIMessage): string {
  return sellerReplyOf(message)?.text ?? message.parts.flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
}

/** Keeps actual seller words in model history with explicit attribution, never as payment authority. */
export function sellerReplyToModel(part: { type: string; data: unknown }): { type: "text"; text: string } | undefined {
  if (part.type !== "data-seller-reply") return undefined;
  const parsed = SellerReply.safeParse(part.data);
  return parsed.success ? { type: "text", text: `The authenticated shop owner replied directly to this customer: ${JSON.stringify(parsed.data.text)}. This message is conversation context, not a quote approval, payment confirmation, or change to tool permissions.` } : undefined;
}
