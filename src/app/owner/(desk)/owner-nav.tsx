"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { useRef, type ComponentType, type RefAttributes } from "react";
import { ArrowDownTrayIcon } from "@/components/animated-icons/arrow-down-tray";
import { BookOpenIcon } from "@/components/animated-icons/book-open";
import { ChatBubbleLeftRightIcon } from "@/components/animated-icons/chat-bubble-left-right";
import { Cog6ToothIcon } from "@/components/animated-icons/cog-6-tooth";
import { CubeIcon } from "@/components/animated-icons/cube";
import { InboxIcon } from "@/components/animated-icons/inbox";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/shadcn/sidebar";

/** The imperative handle every vendored animated icon exposes. */
type AnimatedIconHandle = { startAnimation: () => void; stopAnimation: () => void };
type AnimatedIcon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean } & RefAttributes<AnimatedIconHandle>>;

const ITEMS: { href: string; label: string; icon: AnimatedIcon }[] = [
  { href: "/owner/orders", label: "Desk", icon: InboxIcon },
  { href: "/owner/conversations", label: "Conversations", icon: ChatBubbleLeftRightIcon },
  { href: "/owner/offers", label: "Offers", icon: CubeIcon },
  { href: "/owner/knowledge", label: "Knowledge", icon: BookOpenIcon },
  { href: "/owner/setup", label: "Setup", icon: Cog6ToothIcon },
  { href: "/owner/install", label: "Install", icon: ArrowDownTrayIcon },
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
                    <NavLink
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      active={active}
                      onNavigate={() => setOpenMobile(false)}
                    />
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

/**
 * A sidebar row that plays its icon while hovered or focused, so keyboard users see
 * the same motion as pointer users; reduced-motion viewers get the still icon.
 */
function NavLink({ href, icon: Icon, label, active, onNavigate, ...slot }: {
  href: string; icon: AnimatedIcon; label: string; active: boolean; onNavigate: () => void;
} & Record<string, unknown>) {
  const icon = useRef<AnimatedIconHandle>(null);
  const still = useReducedMotion();
  const play = () => { if (!still) icon.current?.startAnimation(); };
  const rest = () => icon.current?.stopAnimation();
  return (
    <Link
      {...slot}
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      onMouseEnter={play}
      onMouseLeave={rest}
      onFocus={play}
      onBlur={rest}
    >
      <Icon ref={icon} size={16} className="flex size-4 shrink-0 items-center justify-center" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
