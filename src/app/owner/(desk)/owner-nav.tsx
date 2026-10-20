"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Download,
  Inbox,
  MessageSquare,
  Package,
  Settings,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/shadcn/sidebar";

const ITEMS = [
  { href: "/owner/orders", label: "Desk", icon: Inbox },
  { href: "/owner/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/owner/offers", label: "Offers", icon: Package },
  { href: "/owner/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/owner/setup", label: "Setup", icon: Settings },
  { href: "/owner/install", label: "Install", icon: Download },
];

/** Shop destinations rendered through the documented shadcn Sidebar menu. */
export function OwnerNav({ waiting = 0 }: { waiting?: number }) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <nav aria-label="Owner">
          <SidebarMenu>
            {ITEMS.map((item) => {
              const active =
                path === item.href || path.startsWith(`${item.href}/`);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    >
                      <item.icon aria-hidden />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.href === "/owner/orders" && waiting > 0 ? (
                    <SidebarMenuBadge aria-label={`${waiting} need you`}>
                      {waiting}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
