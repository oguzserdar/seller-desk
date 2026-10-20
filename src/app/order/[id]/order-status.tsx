"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { OfferPhoto } from "@/components/buyer/offer-tile";
import { PurchaseLadder } from "@/components/buyer/purchase-ladder";
import { Button } from "@/components/arc/button/button";
import { LinkButton } from "@/components/link-button";
import { Alert } from "@/components/arc/alert/alert";
import { api, readToken, takeFragmentParam } from "@/lib/buyer-client";
import { formatMoney } from "@/lib/money";
import type { BuyerOrderView } from "@/server/domain/orders";
import { OrderHelp } from "@/components/order-help";
import type { OrderFollowupView } from "@/lib/order-followup";

const KEY_PREFIX = "seller-desk.order-key.";

const PICKUP_HEADING = { open: "Ready for pickup", attention: "The shop is checking your pickup", done: "Picked up" };

function rememberKey(orderId: string, key: string) {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + orderId, key);
  } catch {
    // storage blocked: the key stays in memory for this page view
  }
}

function recallKey(orderId: string): string | null {
  try {
    return window.sessionStorage.getItem(KEY_PREFIX + orderId);
  } catch {
    return null;
  }
}

/** Order status for the buyer: payment is final, each obligation shows its own state. */
export function OrderStatus({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (orderKey: string | null) => {
      const result = await api<BuyerOrderView>(`/api/buyer/orders/${orderId}`, { headers: orderKey ? { "X-Order-Key": orderKey } : {} });
      if (!result.data) {
        setProblem(result.httpStatus === 404 ? "This order link is not valid. Use the saved order link or the tab where you paid." : result.message);
        return;
      }
      setOrder(result.data);
    },
    [orderId],
  );

  useEffect(() => {
    const fromFragment = takeFragmentParam("key");
    const orderKey = fromFragment ?? recallKey(orderId);
    if (fromFragment) rememberKey(orderId, fromFragment);
    setKey(orderKey);
    if (!orderKey && !readToken()) {
      setProblem("Open this order from your saved order link, or from the tab where you paid.");
      return;
    }
    void load(orderKey);
  }, [orderId, load]);

  const retryAccess = async () => {
    setBusy(true);
    setNotice(null);
    const result = await api<BuyerOrderView>(`/api/buyer/orders/${orderId}/retry-access`, { method: "POST", json: {}, headers: key ? { "X-Order-Key": key } : {} });
    setBusy(false);
    if (result.data) setOrder(result.data);
    setNotice(result.message);
  };

  const copyLink = async () => {
    if (!order) return;
    const link = `${window.location.origin}/order/${order.id}#key=${encodeURIComponent(order.accessKey)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt("Copy your order link", link);
    }
  };

  if (problem) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Your order</h1>
        <Alert tone="warning" title={problem} />
        <LinkButton href="/buy" variant="secondary" className="self-start">
          Go to the shop
        </LinkButton>
      </div>
    );
  }
  if (!order) {
    return (
      <div role="status" aria-label="Loading your order" className="flex flex-col gap-3">
        <div className="bg-sunken h-9 w-1/2 animate-pulse rounded-[10px]" />
        <div className="bg-sunken h-5 w-2/3 rounded" />
        <div className="bg-sunken mt-4 h-28 rounded-[14px]" />
      </div>
    );
  }

  const accessPending = order.canRetryAccess;
  const pickupTerms = order.snapshot.policy.pickupPolicy;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-success flex items-center gap-2 text-[15px] font-semibold">
          <CheckCircle2 aria-hidden size={18} strokeWidth={2} />
          Paid {formatMoney(order.snapshot.totalMinor, order.snapshot.currency)}. PayPal confirmed it.
        </p>
        <h1 className="page-title mt-2">Order #{order.number}</h1>
        {order.environment === "fixture" ? <p className="text-ink-3 mt-1 text-[13px]">Demo order: no real money moved.</p> : null}
      </div>

      {/* Same marks as the chat's purchase ladder: done, waiting on someone, or needs attention. */}
      <section aria-label="What happens next" role="status" aria-live="polite">
        <PurchaseLadder steps={order.tasks.map((task) => ({
          key: task.type,
          label: task.type !== "pickup" ? task.label : PICKUP_HEADING[task.state === "completed" ? "done" : task.state === "attention" ? "attention" : "open"],
          detail: task.type === "pickup" && task.state !== "completed" && pickupTerms ? pickupTerms : task.detail,
          state: task.tone === "success" ? "done" : task.tone === "attention" ? "attention" : "waiting",
          value: null,
        }))} clamp={false} />
      </section>

      {order.downloads.length > 0 ? (
        <section aria-labelledby="downloads-heading" className="flex flex-col gap-2">
          <h2 id="downloads-heading" className="text-[15px] font-semibold">
            Downloads
          </h2>
          {order.downloads.map((download) => (
            <form key={download.grantId} method="post" action={`/api/download/${download.grantId}`} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="token" value={download.token} />
              <Button type="submit">Download {download.filename}</Button>
              <span className="text-ink-3 text-[13px]">Works until {new Date(download.expiresAt).toLocaleDateString()}.</span>
            </form>
          ))}
        </section>
      ) : null}
      {accessPending ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => void retryAccess()} loading={busy} className="self-start">
            Try the download again
          </Button>
          <p className="text-ink-3 text-[13px]">Trying again never charges you again.</p>
        </div>
      ) : null}
      {notice ? <Alert tone="info" title={notice} /> : null}


      <section aria-labelledby="bought-heading">
        <h2 id="bought-heading" className="text-[15px] font-semibold">
          What you bought
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {order.snapshot.lines.map((line) => (
            <li key={line.offerId} className="flex items-center gap-3">
              <OfferPhoto offer={{ title: line.title, imagePath: order.images[line.offerId] ?? null }} sizes="56px" className="size-14 shrink-0 rounded-[10px]" />
              <span className="min-w-0 flex-1 text-[15px]">
                {line.title}
                {line.quantity > 1 ? <span className="text-ink-3"> x {line.quantity}</span> : null}
              </span>
              <span className="tabular text-[15px] font-semibold">{formatMoney(line.lineTotalMinor, order.snapshot.currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      {order.snapshot.approvedScope ? (
        <section aria-labelledby="confirmed-work-heading" className="border-line border-t pt-5">
          <h2 id="confirmed-work-heading" className="text-[15px] font-semibold">Confirmed work</h2>
          <p className="text-ink-2 mt-1.5 max-w-[68ch] whitespace-pre-wrap text-[14px] leading-relaxed">{order.snapshot.approvedScope}</p>
        </section>
      ) : null}

      <OrderHelp audience="buyer" view={order.followup} onRefresh={async () => {
        const result = await api<BuyerOrderView>(`/api/buyer/orders/${orderId}`, { headers: key ? { "X-Order-Key": key } : {} });
        if (!result.data) throw new Error(result.message);
        setOrder(result.data);
      }} onSend={async input => {
        if (input.action === "reply") return;
        const result = await api<OrderFollowupView>(`/api/buyer/orders/${orderId}/help`, { method: "POST", headers: key ? { "X-Order-Key": key } : {}, json: { ...input, orderId } });
        if (!result.data) throw new Error(result.message);
        setOrder(current => current ? { ...current, followup: result.data! } : current);
      }} />

      <div className="border-line flex flex-col gap-2 border-t pt-5">
        <Button variant="secondary" onClick={() => void copyLink()} className="self-start">
          {copied ? "Order link copied" : "Copy your order link"}
        </Button>
        <p className="text-ink-3 text-[13px]">The link opens this order, downloads and messages for 30 days. Anyone with it can send feedback on this order. Keep it private.</p>
      </div>
    </div>
  );
}
