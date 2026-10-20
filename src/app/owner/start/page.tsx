import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSeller } from "@/server/domain/seller";
import { firstOwnerSetupEnabled } from "@/server/auth/first-owner";
import { LinkButton } from "@/components/link-button";
import { FirstOwnerForm } from "./form";

export const metadata: Metadata = { title: "Set up your desk" };
export const dynamic = "force-dynamic";

/** First-visit setup remains closed unless the host operator explicitly enables it with a token. */
export default async function FirstOwnerPage() {
  if (await getSeller()) redirect("/owner/login");
  return <main className="mx-auto w-full max-w-lg px-4 py-12 sm:py-20">
    <h1 className="page-title">Set up your desk</h1>
    {firstOwnerSetupEnabled() ? <><p className="text-ink-2 mt-3 text-[16px] leading-relaxed">Create the owner account for this installation. Use the private installation token from your hosting settings.</p><FirstOwnerForm /></> : <><p className="text-ink-2 mt-3 text-[16px] leading-relaxed">Owner setup is closed. The person who installed this desk can enable it with a private installation token.</p><LinkButton href="/owner/login" variant="secondary" className="mt-6">Sign in</LinkButton></>}
  </main>;
}
