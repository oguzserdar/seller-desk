import { redirect } from "next/navigation";
import { getSeller } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";

export const dynamic = "force-dynamic";

/** A fresh deployment opens setup; an installed shop opens its customer page, or the About page on a public demo. */
export default async function HomePage() {
  if (!(await getSeller())) redirect("/owner/start");
  redirect(getServerConfig().publicDemo ? "/about" : "/buy");
}
