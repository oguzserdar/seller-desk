import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SellerDeskHome, homeMetadata } from "@/components/about/home";
import { getSeller } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return getServerConfig().publicDemo ? homeMetadata(true) : {};
}

/**
 * A fresh deployment opens setup and an installed shop opens its customer page. A public demo of
 * Seller Desk itself opens the Seller Desk home page instead.
 */
export default async function HomePage() {
  if (!(await getSeller())) redirect("/owner/start");
  if (!getServerConfig().publicDemo) redirect("/buy");
  return <SellerDeskHome />;
}
