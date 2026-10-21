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
  children,
}: {
  shopName: string;
  name: string;
  email: string;
  waiting: number;
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
        className="min-w-0 overflow-hidden outline-none"
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
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
