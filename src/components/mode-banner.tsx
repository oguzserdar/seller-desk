import { getServerConfig } from "@/server/env";
import Link from "next/link";
import { connection } from "next/server";

/**
 * Keeps payment mode visible without exposing model infrastructure in every page.
 */
export async function ModeBanner() {
  await connection();
  const config = getServerConfig();
  if (config.mode === "fixture") {
    return (
      <div role="note" className="bg-fixture-soft text-fixture border-b border-[#dde1e7] px-4 py-1.5 text-center text-[13px] font-medium">
        Demo · Payments are simulated. No money moves.
      </div>
    );
  }
  return (
    <div role="note" className="bg-sunken text-ink-2 border-line border-b px-4 py-1.5 text-center text-[13px] font-medium">
      PayPal sandbox · Test payments only.
      {config.publicDemo ? (
        <>
          {" · "}
          <Link href="/#judging" className="text-brand font-semibold hover:underline">About this demo</Link>
        </>
      ) : null}
    </div>
  );
}
