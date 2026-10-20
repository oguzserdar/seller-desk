import { cookies, headers } from "next/headers";
import {
  DESK_THEME_COOKIE,
  deskThemeId,
  deskThemeStyle,
} from "@/lib/desk-themes";
import { redirect } from "next/navigation";
import { readOwner } from "@/server/auth/owner";
import { queryDesk } from "@/server/domain/desk";
import { openQuestions } from "@/server/domain/seller-questions";
import { OwnerShell } from "./owner-shell";

export default async function OwnerDeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await readOwner(await headers());
  if (!context) redirect("/owner/login");
  // The theme is applied on the server, so the first paint is already in the owner's colours.
  const theme = deskThemeId((await cookies()).get(DESK_THEME_COOKIE)?.value);
  const [questions, attention] = await Promise.all([
    openQuestions(context.owner),
    queryDesk(context.owner, { view: "needs_attention" }),
  ]);
  return (
    <div
      data-desk-theme={theme}
      style={deskThemeStyle(theme)}
      className="desk-theme bg-canvas text-ink min-h-[calc(100dvh-var(--banner-h,0px))]"
    >
      <a
        href="#main"
        className="bg-surface text-ink sr-only rounded-[var(--radius-control)] px-3 py-2 text-[14px] font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <OwnerShell
        shopName={context.seller.displayName}
        name={context.name}
        email={context.email}
        waiting={questions.length + attention.rows.length}
      >
        {children}
      </OwnerShell>
    </div>
  );
}
