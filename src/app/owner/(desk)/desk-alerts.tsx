"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/shadcn/sidebar";

type Waiting = { waiting: number; questions: number; newestQuestion: { id: string; question: string } | null };

/**
 * Keeps the desk's "needs you" count live while it is open, including in a
 * background tab. A new customer question puts the count in the tab title,
 * refreshes the page's lists and, when allowed, raises a system notification.
 *
 * @example
 * ```tsx
 * const waiting = useDeskWaiting(initialWaiting, shopName);
 * ```
 */
export function useDeskWaiting(initial: number, shopName: string): number {
  const router = useRouter();
  const [waiting, setWaiting] = useState(initial);
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => setWaiting(initial), [initial]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const base = document.title.replace(/^\(\d+\) /, "");
    const check = async () => {
      try {
        const response = await fetch("/api/owner/waiting", { cache: "no-store" });
        const body = (await response.json()) as { data: Waiting | null };
        if (cancelled || !body.data) return;
        const { waiting: count, newestQuestion } = body.data;
        setWaiting(count);
        const newest = newestQuestion?.id ?? null;
        if (seen.current !== undefined && newest && newest !== seen.current) {
          router.refresh();
          if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
            const note = new Notification(`A customer is waiting at ${shopName}`, { body: newestQuestion!.question.slice(0, 140), tag: "desk-question" });
            note.onclick = () => { window.focus(); note.close(); };
          }
        }
        seen.current = newest;
        document.title = count > 0 && document.visibilityState !== "visible" ? `(${count}) ${base}` : base;
      } catch {
        // A missed check is retried on the next tick; the desk itself still works.
      } finally {
        if (!cancelled) timer = setTimeout(check, document.visibilityState === "visible" ? 15_000 : 30_000);
      }
    };
    const visible = () => { if (document.visibilityState === "visible") document.title = base; };
    void check();
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); document.title = base; };
  }, [router, shopName]);
  return waiting;
}

/** Offers system notifications for new customer questions until the owner has answered the browser's prompt. */
export function DeskAlertsToggle() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => setPermission("Notification" in window ? Notification.permission : "unsupported"), []);
  if (permission !== "default") return null;
  return (
    <SidebarMenu className="px-2">
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Notify me about new questions" onClick={() => void Notification.requestPermission().then(setPermission)}>
          <Bell aria-hidden />
          <span>Turn on question alerts</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
