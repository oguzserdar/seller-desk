"use client";
import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/buyer-client";
import type { BuyerReplyState } from "@/lib/conversation-messages";
import type { ConversationControl } from "@/server/domain/conversation-control";
import type { SellerHandoff } from "./seller-reply";

/** The authoritative buyer conversation snapshot, including human ownership. */
export type BuyerHistory = { messages: UIMessage[]; assistant: boolean; control: ConversationControl; handoff: SellerHandoff | null; replyState: BuyerReplyState };

/**
 * How long to wait before the next ownership check. A seller-owned chat or a
 * recently active one is checked every 2 s; a quiet one backs off to 10 s, then 30 s.
 */
export function pollDelay(sellerOwned: boolean, idleMs: number): number {
  if (sellerOwned || idleMs < 30_000) return 2_000;
  return idleMs < 120_000 ? 10_000 : 30_000;
}

/** Follows durable ownership while streaming and clears revoked, unfinished AI output. */
export function useConversationSync({ ready, messages, status, stop, clearError, setMessages, setHandoff }: {
  ready: boolean; messages: UIMessage[]; status: ChatStatus; stop: () => Promise<void>; clearError: () => void;
  setMessages: (messages: UIMessage[]) => void; setHandoff: (value: SellerHandoff | null) => void;
}) {
  const [control, setControl] = useState<ConversationControl | null>(null);
  const [savedReply, setSavedReply] = useState<{ state: BuyerReplyState; messageId?: string }>({ state: "idle" });
  const current = useRef({ control, messages, status }); current.current = { control, messages, status };
  const confirmedCustomer = useRef<string | null>(null);
  const serial = useRef(0);
  const restore = useCallback((value: ConversationControl | null, savedMessages: UIMessage[] = [], replyState: BuyerReplyState = "idle") => {
    ++serial.current; confirmedCustomer.current = savedMessages.findLast(message => message.role === "user")?.id ?? null;
    setSavedReply({ state: replyState, messageId: savedMessages.at(-1)?.id });
    current.current.control = value; setControl(value);
  }, []);
  const refresh = useCallback(async () => {
    if (!ready) return;
    const request = ++serial.current;
    const history = await api<BuyerHistory>("/api/buyer/chat");
    if (request !== serial.current || !history.data) return;
    const snapshot = history.data; const prior = current.current.control;
    if (prior && (prior.id !== snapshot.control.id || snapshot.control.revision < prior.revision)) return;
    const changed = prior && snapshot.control.revision > prior.revision;
    if (changed) { await stop(); if (request !== serial.current) return; }
    const busy = current.current.status === "submitted" || current.current.status === "streaming";
    current.current.control = snapshot.control; setControl(snapshot.control); setHandoff(snapshot.handoff);
    setSavedReply({ state: snapshot.replyState, messageId: snapshot.messages.at(-1)?.id });
    if (changed || !busy) {
      const existing = current.current.messages;
      // A failed send remains retryable. Do not revive older history outside the
      // server's bounded window, or retain revoked partial assistant output.
      const latestCustomer = existing.findLast(message => message.role === "user");
      if (latestCustomer && snapshot.messages.some(message => message.id === latestCustomer.id)) confirmedCustomer.current = latestCustomer.id;
      const undelivered = latestCustomer && confirmedCustomer.current !== latestCustomer.id;
      const next = undelivered ? [...snapshot.messages, latestCustomer] : snapshot.messages;
      if (changed || existing.length !== next.length || existing.at(-1)?.id !== next.at(-1)?.id) setMessages(next);
      if (changed && !undelivered) clearError();
    }
  }, [ready, stop, clearError, setMessages, setHandoff]);
  const active = messages.length > 0 || control?.handler === "seller";
  const lastActivity = useRef(Date.now());
  useEffect(() => { lastActivity.current = Date.now(); }, [messages.length, status, control?.handler]);
  useEffect(() => {
    if (!ready || !active) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!cancelled && document.visibilityState === "visible") await refresh();
      if (!cancelled) timer = setTimeout(poll, pollDelay(current.current.control?.handler === "seller", Date.now() - lastActivity.current));
    };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    timer = setTimeout(poll, 1000); document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; clearTimeout(timer); ++serial.current; document.removeEventListener("visibilitychange", visible); };
  }, [ready, active, refresh]);
  useEffect(() => { if (ready && active && status !== "submitted" && status !== "streaming") void refresh(); }, [ready, active, status, refresh]);
  const latest = messages.at(-1);
  const replyState = control?.handler === "assistant" && latest?.role === "user" && latest.id === savedReply.messageId ? savedReply.state : "idle";
  return { control, restore, replyState };
}
