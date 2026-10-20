"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ownerAction } from "@/server/actions/safe-action";
import { changeConversationHandler } from "@/server/domain/conversation-control";
import { readSellerConversation, sendSellerMessage, SellerMessage } from "@/server/domain/conversation-messages";
import { requireUsage } from "@/server/domain/usage";

/** Authenticated refresh after the initial server-rendered conversation. */
export const refreshConversationAction = ownerAction.inputSchema(z.object({ id: z.uuid() }).strict()).action(async ({ parsedInput, ctx }) => {
  await requireUsage("owner_conversation_read", ctx.owner.userId, 600, 240, "Reloading conversations too quickly.");
  return readSellerConversation(ctx.owner, parsedInput.id);
});

/** Revokes the active AI turn or explicitly returns control to the assistant. */
export const controlConversationAction = ownerAction.inputSchema(z.object({ id: z.uuid(), expectedRevision: z.number().int().positive(), handler: z.enum(["assistant", "seller"]) }).strict()).action(async ({ parsedInput, ctx }) => {
  await changeConversationHandler(ctx.owner, parsedInput);
  revalidatePath("/owner/conversations");
  return readSellerConversation(ctx.owner, parsedInput.id);
});

/** Sends the authenticated seller's words, preserving their identity and retry id. */
export const replyToConversationAction = ownerAction.inputSchema(SellerMessage).action(async ({ parsedInput, ctx }) => {
  await requireUsage("owner_conversation_send", ctx.owner.userId, 600, 120, "Sending replies too quickly.");
  const result = await sendSellerMessage(ctx.owner, parsedInput);
  revalidatePath("/owner/conversations"); revalidatePath("/owner/orders");
  return result;
});
