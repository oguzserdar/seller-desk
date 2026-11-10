"use client";

import { useState, type ReactNode } from "react";
import { DeskAlertsToggle, useDeskWaiting } from "./desk-alerts";
import Link from "next/link";
import { Store } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/shadcn/sidebar";
import { Separator } from "@/components/shadcn/separator";
import { AccountMenu } from "./account-menu";
import { OwnerNav } from "./owner-nav";

/** Arc supplies the account control; the Sidebar state selects its documented compact trigger. */
function SidebarAccount({ name, email }: { name: string; email: string }) {
  const { state } = useSidebar();
  return (
    <AccountMenu name={name} email={email} showName={state === "expanded"} />
  );
}

/** Local review candidate: library sidebar with icon collapse, footer account and a scrolling workspace. */
export function OwnerShell({
  shopName,
  name,
  email,
  waiting,
  viewer = false,
  children,
}: {
  shopName: string;
  name: string;
  email: string;
  waiting: number;
  /** A visitor looking around a public demo: the desk says so and offers the owner's sign-in. */
  viewer?: boolean;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const live = useDeskWaiting(waiting, shopName);
  return (
    <SidebarProvider
      ref={setContainer}
      className="h-[calc(100dvh-var(--banner-h,0px))] min-h-0"
    >
      <Sidebar
        collapsible="icon"
        portalContainer={container}
        className="top-[var(--banner-h,0px)] h-[calc(100svh-var(--banner-h,0px))]"
      >
        <SidebarHeader className="h-14 justify-center">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip={shopName}>
                <Link href="/owner/orders">
                  <Store aria-hidden />
                  <span>{shopName}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <OwnerNav waiting={live} />
          <DeskAlertsToggle />
        </SidebarContent>
        <SidebarFooter className="hidden md:flex">
          <SidebarAccount name={name} email={email} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset
        id="main"
        tabIndex={-1}
        // clip, not hidden: a hidden frame still scrolls when a focused field is brought into view,
        // which slid the header under the sandbox banner. Only the inner panel below scrolls.
        className="min-w-0 overflow-clip outline-none"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Link href="/owner/orders" className="truncate text-sm font-medium">
            {shopName}
          </Link>
          <div className="ml-auto md:hidden">
            <AccountMenu name={name} email={email} showName={false} />
          </div>
        </header>
        {viewer ? (
          <p role="note" className="bg-brand-soft text-ink border-line shrink-0 border-b px-4 py-2 text-[13.5px] leading-snug">
            <strong className="font-semibold">Demo desk.</strong> You can open every page. Nothing can be changed here.{" "}
            <Link href="/owner/login" className="text-brand font-semibold underline underline-offset-2">Sign in as the owner</Link>
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
