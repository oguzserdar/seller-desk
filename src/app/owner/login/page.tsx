import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readOwner } from "@/server/auth/owner";
import { getSeller } from "@/server/domain/seller";
import { connectorResumeUrl, pageQuery } from "@/lib/connector-resume";
import { LoginForm } from "./login-form";
import { firstOwnerSetupEnabled } from "@/server/auth/first-owner";

export const metadata: Metadata = { title: "Owner sign in" };

export default async function OwnerLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await readOwner(await headers())) {
    redirect(connectorResumeUrl(pageQuery(await searchParams)) ?? "/owner/orders");
  }
  const shop = await getSeller();
  if (!shop && firstOwnerSetupEnabled()) redirect("/owner/start");
  return (
    <main className="mx-auto flex min-h-[80dvh] w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="page-title">Sign in to your desk</h1>
      <p className="text-ink-2 mt-2">
        {shop
          ? `Manage ${shop.displayName}.`
          : "Use your owner account to manage your shop."}
      </p>
      <LoginForm />
      {process.env.NODE_ENV === "development" ? (
        <details className="text-ink-3 mt-6 text-[13px] leading-relaxed">
          <summary className="cursor-pointer">Developer setup</summary>
          <p className="mt-2">
            Manage owner credentials with the operator commands in the
            installation guide. For a local demo, run{" "}
            <code className="font-mono">pnpm demo</code> or{" "}
            <code className="font-mono">pnpm demo:d1</code>.
          </p>
        </details>
      ) : null}
    </main>
  );
}
