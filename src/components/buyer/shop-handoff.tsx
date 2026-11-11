"use client";

import { Bell, Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/arc/button/button";

type Permission = NotificationPermission | "unsupported";

function currentPermission(): Permission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

/**
 * A question the assistant handed to the shop owner, shown as a sent message
 * with a live waiting state. The buyer can ask to be notified, and is told the
 * answer stays in this chat, so leaving the page loses nothing.
 */
export function ShopQuestionSent({ shopName, question, waiting }: { shopName: string; question: string; waiting: boolean }) {
  const initial = shopName.trim().charAt(0).toUpperCase() || "S";

  return (
    <div role={waiting ? "status" : undefined} className="enter shop-handoff">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="shop-handoff-avatar">{initial}</span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight">Asked {shopName}</p>
          {waiting ? (
            <p className="text-ink-3 flex items-center gap-1.5 text-[13px]">
              <span aria-hidden className="shop-handoff-dot" />
              Waiting for the owner&apos;s reply
            </p>
          ) : null}
        </div>
      </div>
      <p className="shop-handoff-question">{question}</p>
      {waiting ? (
        <NotifyWhenReady className="mt-3" ask="Notify me when they reply" granted="You'll get a notification when they reply">
          The reply lands in this chat, so you can close the page and come back.
        </NotifyWhenReady>
      ) : null}
    </div>
  );
}

/**
 * Lets a waiting buyer ask for a system notification, and says that leaving the page loses nothing.
 * Hidden when the browser cannot notify or the buyer already declined; the reassurance always shows.
 */
export function NotifyWhenReady({ ask, granted, children, className = "" }: { ask: string; granted: string; children: ReactNode; className?: string }) {
  const [permission, setPermission] = useState<Permission>("unsupported");
  useEffect(() => setPermission(currentPermission()), []);
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      {permission === "default" ? (
        <Button type="button" variant="secondary" onClick={() => void Notification.requestPermission().then(setPermission)}>
          <Bell aria-hidden size={16} strokeWidth={1.75} />
          {ask}
        </Button>
      ) : permission === "granted" ? (
        <p className="text-ink-2 flex items-center gap-1.5 text-[13px]">
          <Check aria-hidden size={14} strokeWidth={2} />
          {granted}
        </p>
      ) : null}
      <p className="text-ink-3 text-[13px]">{children}</p>
    </div>
  );
}

/**
 * Tells the buyer the shop finished pricing their request: a count in the tab title until they look,
 * and a system notification when they allowed one and the page is hidden.
 *
 * @example
 * ```tsx
 * useQuoteReadyAlert({ shopName, status: quote.quote?.status });
 * ```
 */
export function useQuoteReadyAlert({ shopName, status }: { shopName: string; status?: string }) {
  const last = useRef(status);
  useEffect(() => {
    const before = last.current;
    last.current = status;
    if (before !== "seller_review" || !status || status === "seller_review" || status === "expired") return;
    const base = document.title.replace(/^\(1\) /, "");
    if (document.visibilityState === "visible") return;
    document.title = `(1) ${base}`;
    const clear = () => { if (document.visibilityState === "visible") { document.title = base; document.removeEventListener("visibilitychange", clear); } };
    document.addEventListener("visibilitychange", clear);
    if (currentPermission() === "granted") {
      const note = new Notification(`${shopName} sent your quote`, { body: "Open it to review the price before you pay.", tag: "shop-quote" });
      note.onclick = () => { window.focus(); note.close(); };
    }
  }, [shopName, status]);
}

/**
 * Tells the buyer the shop replied: a count in the tab title until they look,
 * and a system notification when they allowed one and the page is hidden.
 *
 * @example
 * ```tsx
 * useShopReplyAlert({ shopName, state: handoff?.state, answer: handoff?.answer });
 * ```
 */
export function useShopReplyAlert({ shopName, state, answer }: { shopName: string; state?: string; answer?: string | null }) {
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (state === "open") { wasWaiting.current = true; return; }
    if (!wasWaiting.current || !state) return;
    wasWaiting.current = false;
    const base = document.title.replace(/^\(1\) /, "");
    if (document.visibilityState !== "visible") {
      document.title = `(1) ${base}`;
      const clear = () => { if (document.visibilityState === "visible") { document.title = base; document.removeEventListener("visibilitychange", clear); } };
      document.addEventListener("visibilitychange", clear);
      if (currentPermission() === "granted") {
        const note = new Notification(`${shopName} replied`, { body: answer?.slice(0, 140) ?? undefined, tag: "shop-reply" });
        note.onclick = () => { window.focus(); note.close(); };
      }
    }
  }, [shopName, state, answer]);
}

/** Counts questions that went from waiting to answered, so the thread can bring each answer into view. */
export function useAnswersArrived(state?: string): number {
  const [arrived, setArrived] = useState(0);
  const last = useRef(state);
  useEffect(() => {
    if (last.current === "open" && state && state !== "open") setArrived((n) => n + 1);
    last.current = state;
  }, [state]);
  return arrived;
}
