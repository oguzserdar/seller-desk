import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { pageQuery } from "@/lib/connector-resume";
import { getAuth } from "@/server/auth/auth";
import { readOwner } from "@/server/auth/owner";
import { ConsentButtons } from "./consent-buttons";

export const metadata: Metadata = { title: "Connect an AI app" };

const CAN = [
  "See buyers and questions waiting for you",
  "Read conversations, orders and your offers",
  "Draft answers for you to check and send",
];
const CANNOT = ["Message a buyer", "Change prices, stock or orders", "Refund or take payments"];

/** The consent page Better Auth sends an AI app's access request to, after the owner signs in. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requestHeaders = await headers();
  const oauthQuery = pageQuery(await searchParams);
  const query = new URLSearchParams(oauthQuery);
  const clientId = query.get("client_id");
  if (!clientId || !query.has("sig")) notFound();
  const owner = await readOwner(requestHeaders);
  if (!owner) redirect(`/owner/login?${oauthQuery}`);
  const client = await getAuth()
    .api.getOAuthClientPublic({ query: { client_id: clientId }, headers: requestHeaders })
    .catch(() => null);
  if (!client) notFound();
  const appName = (client as { client_name?: string }).client_name?.trim() || "This AI app";

  return (
    <main className="mx-auto flex min-h-[80dvh] w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="page-title">{appName} wants to use your desk</h1>
      <p className="text-ink-2 mt-2">For {owner.seller.displayName}. You can remove it any time in Setup.</p>
      <h2 className="mt-8 text-[15px] font-semibold">It will be able to</h2>
      <ul className="text-ink-2 mt-2 list-disc pl-5 text-[15px] leading-relaxed">
        {CAN.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <h2 className="mt-6 text-[15px] font-semibold">It will not be able to</h2>
      <ul className="text-ink-2 mt-2 list-disc pl-5 text-[15px] leading-relaxed">
        {CANNOT.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <ConsentButtons oauthQuery={oauthQuery} appName={appName} />
    </main>
  );
}
