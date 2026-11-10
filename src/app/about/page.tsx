import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SellerDeskHome, homeMetadata } from "@/components/about/home";
import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return homeMetadata(false);
}

/** "About Seller Desk" on a real shop. A public demo shows the same page as its home address. */
export default function AboutPage() {
  if (getServerConfig().publicDemo) redirect("/");
  return <SellerDeskHome />;
}
