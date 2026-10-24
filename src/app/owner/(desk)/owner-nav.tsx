"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { useRef, type ComponentType, type RefAttributes } from "react";
import {
  ConversationsIcon,
  DeskIcon,
  InstallIcon,
  KnowledgeIcon,
  OffersIcon,
  SetupIcon,
  type DeskIconHandle,
} from "@/components/desk-icons";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/shadcn/sidebar";

type AnimatedIcon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean } & RefAttributes<DeskIconHandle>>;

const ITEMS: { href: string; label: string; icon: AnimatedIcon }[] = [
  { href: "/owner/orders", label: "Desk", icon: DeskIcon },
  { href: "/owner/conversations", label: "Conversations", icon: ConversationsIcon },
  { href: "/owner/offers", label: "Offers", icon: OffersIcon },
  { href: "/owner/knowledge", label: "Knowledge", icon: KnowledgeIcon },
  { href: "/owner/setup", label: "Setup", icon: SetupIcon },
  { href: "/owner/install", label: "Install", icon: InstallIcon },
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
  const icon = useRef<DeskIconHandle>(null);
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
      <Icon ref={icon} size={20} className="flex size-5 shrink-0 items-center justify-center" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
