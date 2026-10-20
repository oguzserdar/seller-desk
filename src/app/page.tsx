import { redirect } from "next/navigation";
import { getSeller } from "@/server/domain/seller";

export const dynamic = "force-dynamic";

/** A fresh deployment opens setup; an installed shop opens its customer page. */
export default async function HomePage() {
  redirect(await getSeller() ? "/buy" : "/owner/start");
}
