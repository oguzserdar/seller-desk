"use client";

import type { ReactNode } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "./internal/conversation";
import { MessageResponse } from "./internal/message-response";

/** Seller Desk's bounded conversation surface, independent of the underlying component library. */
export function ShopConversation({ children, shopName }: { children: ReactNode; shopName: string }) {
  return <Conversation label={`Conversation with ${shopName}`}><ConversationContent>{children}</ConversationContent><ConversationScrollButton /></Conversation>;
}

/** Seller Desk's answer typography and safe Markdown policy. */
export function AssistantAnswer({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <MessageResponse text={text} streaming={streaming} />;
}
