"use client";

import type { ReactNode } from "react";
import { Conversation, ConversationContent, ConversationFollowOnSend, ConversationScrollButton } from "./internal/conversation";
import { MessageResponse } from "./internal/message-response";

/** Seller Desk's bounded conversation surface, independent of the underlying component library. */
export function ShopConversation({ children, shopName, sending = false }: { children: ReactNode; shopName: string; sending?: boolean }) {
  return <Conversation label={`Conversation with ${shopName}`}><ConversationContent>{children}</ConversationContent><ConversationScrollButton /><ConversationFollowOnSend sending={sending} /></Conversation>;
}

/** Seller Desk's answer typography and safe Markdown policy. */
export function AssistantAnswer({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <MessageResponse text={text} streaming={streaming} />;
}
