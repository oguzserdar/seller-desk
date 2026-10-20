"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OrderHelp } from "@/components/order-help";
import type { OrderFollowupView } from "@/lib/order-followup";
import { replyOrderHelpAction } from "../../actions";

/** The seller can answer a problem; only the buyer can confirm it resolved. */
export function OwnerOrderHelp({ orderId, initial }: { orderId: string; initial: OrderFollowupView }) {
  const [saved, setSaved] = useState(initial);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const view = initial.revision > saved.revision ? initial : saved;
  return <OrderHelp audience="owner" view={view} onRefresh={async () => { startTransition(() => router.refresh()); }} onSend={async input => {
    if (input.action !== "reply") throw new Error("Only a reply is available to the shop.");
    const result = await replyOrderHelpAction({ orderId, expectedRevision: input.expectedRevision, message: input.message });
    if (!result?.data) throw new Error(result?.serverError ?? "Your reply could not be confirmed. Keep your words and try again.");
    setSaved(result.data);
  }} />;
}
