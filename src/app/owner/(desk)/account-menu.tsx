"use client";

import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/shadcn/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/shadcn/sidebar";
import { Alert } from "@/components/arc/alert/alert";
import { authClient } from "@/lib/auth-client";
import { forgetOwnerHistory } from "@/components/insights/analyst-history";

/** Official shadcn sidebar-07 account composition, wired only to real owner settings and sign-out. */
export function AccountMenu({
  name,
  email,
  showName = true,
}: {
  name: string;
  email: string;
  showName?: boolean;
}) {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) setContainer(node.closest<HTMLElement>(".desk-theme"));
  }, []);
  const [isPending, setPending] = useState(false);
  const firstName = name.trim().split(/\s+/)[0] || "Your account";
  const initials = firstName.slice(0, 1).toLocaleUpperCase();
  // Better Auth ends the owner session; the demo pass is a cookie of its own. Then a full page load.
  const signOut = async () => {
    setError(null);
    setPending(true);
    try {
      const [session, pass] = await Promise.all([
        authClient.signOut(),
        fetch("/owner/demo", { method: "DELETE" }),
      ]);
      // A demo visitor has no Better Auth session; that sign-out "error" is not a failure, the pass is what ends.
      const ended = !session.error || session.error.code === "FAILED_TO_GET_SESSION";
      if (ended && pass.ok) {
        // Analyst chats hold customer labels and amounts; a shared browser should not keep them.
        forgetOwnerHistory();
        window.location.assign("/owner/login");
        return; // stays busy until the page leaves
      }
    } catch {
      // Shown below.
    }
    setError("Could not sign out. Try again.");
    setPending(false);
  };
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                ref={triggerRef}
                size="lg"
                aria-label={`Account menu, ${firstName}`}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {showName ? (
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{firstName}</span>
                  </div>
                ) : null}
                {showName ? (
                  <ChevronsUpDown className="ml-auto size-4" />
                ) : null}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              portalContainer={container}
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{firstName}</span>
                    <span className="truncate text-xs">{email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isPending}
                onSelect={() => router.push("/owner/setup")}
              >
                <Settings />
                Setup
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  void signOut();
                }}
              >
                <LogOut />
                {isPending ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      {error ? <Alert tone="danger" title={error} /> : null}
    </>
  );
}
