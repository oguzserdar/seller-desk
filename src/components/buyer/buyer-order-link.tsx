"use client";

import { Button } from "@/components/arc/button/button";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/buyer-client";
import type { BuyerOrderView } from "@/server/domain/orders";

type Props = { orderId: string; widget: boolean; children: ReactNode };
const linkClass =
  "text-brand inline-flex min-h-11 items-center text-[14px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-4";

/** Keeps receipt navigation outside an embedded chat, using the existing order-scoped access link. */
export function BuyerOrderLink({ orderId, widget, children }: Props) {
  return widget ? (
    <WidgetOrderLink key={orderId} orderId={orderId}>
      {children}
    </WidgetOrderLink>
  ) : (
    <Link href={`/order/${encodeURIComponent(orderId)}`} className={linkClass}>
      {children}
    </Link>
  );
}

function WidgetOrderLink({ orderId, children }: Omit<Props, "widget">) {
  const [href, setHref] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHref(null);
    setFailed(false);
    void api<Pick<BuyerOrderView, "id" | "accessKey">>(
      `/api/buyer/orders/${encodeURIComponent(orderId)}`,
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (
        result.httpStatus === 200 &&
        result.data?.id === orderId &&
        typeof result.data.accessKey === "string" &&
        result.data.accessKey
      ) {
        setHref(
          `/order/${encodeURIComponent(orderId)}#key=${encodeURIComponent(result.data.accessKey)}`,
        );
      } else setFailed(true);
    });
    return () => controller.abort();
  }, [orderId, retry]);

  if (href)
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        {children} (new tab)
      </a>
    );
  if (failed)
    return (
      <span className="block text-[14px] text-ink-2">
        Could not open this order.{" "}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </Button>
      </span>
    );
  return (
    <span role="status" className="block py-3 text-[14px] text-ink-3">
      Preparing your order link…
    </span>
  );
}
