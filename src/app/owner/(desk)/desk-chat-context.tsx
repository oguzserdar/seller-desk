"use client";

import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { OwnerHistory } from "@/server/ai/owner-conversation";

const Context = createContext<{ chat: Chat<UIMessage>; history: OwnerHistory } | null>(null);

/** Shares one chat between the desktop panel and phone sheet, seeded by an authenticated server read. */
export function DeskChatProvider({ history, children }: { history: OwnerHistory; children: React.ReactNode }) {
  const router = useRouter();
  const [chat] = useState(() => new Chat<UIMessage>({
    messages: history.messages,
    transport: new DefaultChatTransport({
      api: "/api/owner/chat",
      prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }),
    }),
    onFinish: () => router.refresh(),
  }));
  useEffect(() => {
    // A bounded wait recovers a turn running in another tab or interrupted by navigation.
    if (!history.busyUntil) return;
    const timer = setTimeout(() => router.refresh(), Math.min(5000, Math.max(1000, new Date(history.busyUntil).getTime() - Date.now())));
    return () => clearTimeout(timer);
  }, [history.busyUntil, history.messages, router]);
  useEffect(() => {
    // Never replace a live stream. Fresh server messages may complete a turn from another tab.
    if (chat.status === "submitted" || chat.status === "streaming") return;
    if (history.messages.at(-1)?.id !== chat.messages.at(-1)?.id && history.messages.length) chat.messages = history.messages;
  }, [chat, history.messages]);
  return <Context.Provider value={{ chat, history }}>{children}</Context.Provider>;
}

/** Reads the shared owner conversation; no history or secrets are stored in localStorage. */
export function useDeskChat() {
  const value = useContext(Context);
  if (!value) throw new Error("Desk assistant requires its conversation provider.");
  return value;
}
