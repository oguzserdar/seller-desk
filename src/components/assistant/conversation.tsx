"use client";

import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Conversation, ConversationContent, ConversationFollowOnSend, ConversationScrollButton } from "./internal/conversation";

// The Markdown renderer is a third of the page's JavaScript and only matters once an answer exists,
// so it loads in the background after the page is idle instead of before first paint.
const loadResponse = () => import("./internal/message-response");
const MessageResponse = lazy(() => loadResponse().then((module) => ({ default: module.MessageResponse })));

/** Seller Desk's bounded conversation surface, independent of the underlying component library. */
export function ShopConversation({ children, shopName, sending = false, follow = 0, browse = false }: { children: ReactNode; shopName: string; sending?: boolean; follow?: number; /** Products before any message: a plain list that starts at the top, not a log that follows its end. */ browse?: boolean }) {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1));
    idle(() => void loadResponse());
  }, []);
  if (browse) return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden"><div className="conversation-scroll flex-1 overflow-y-auto"><div className="conversation-content">{children}</div></div></div>;
  return <Conversation label={`Conversation with ${shopName}`}><ConversationContent>{children}</ConversationContent><ConversationScrollButton /><ConversationFollowOnSend sending={sending} follow={follow} /></Conversation>;
}

/** Seller Desk's answer typography and safe Markdown policy. */
export function AssistantAnswer({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
      <MessageResponse text={text} streaming={streaming} />
    </Suspense>
  );
}
