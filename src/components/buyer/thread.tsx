"use client";

import { isToolUIPart, type ChatStatus, type UIMessage } from "ai";
import { ReceiptText } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import { sellerReplyOf } from "@/lib/conversation-messages";
import { AssistantAnswer } from "@/components/assistant/conversation";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import { formatQuoteAmount } from "@/lib/money";
import type { CatalogLook, ShownOffers } from "@/server/ai/catalog-search";
import { OfferCard } from "./offer-tile";
import { ShopQuestionSent } from "./shop-handoff";
import { KnowledgeSources, ShopNextStep } from "./shop-knowledge";
import type { GuideSource, ShopStep } from "@/lib/shop-guide";
import type { StoreResult } from "@/lib/connected-store";
import { StoreProducts } from "./store-products";
import { BuyerOrderLink } from "./buyer-order-link";
import { PaymentResult, type PaymentResultEvidence } from "./payment-result";

type QuoteToolOutput = {
  error?: string;
  status?: string;
  totalMinor?: number | null;
  currency?: string;
  lines?: { quantity: number }[];
};

function Searching({ shopName }: { shopName: string }) {
  return (
    <div className="enter" role="status">
      <p className="text-ink-3 text-[14px]">Looking through {shopName}…</p>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className={i === 2 ? "hidden sm:block" : undefined}>
            <div className="bg-sunken aspect-square animate-pulse rounded-[12px]" />
            <div className="bg-sunken mt-3 h-3.5 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Displays a live waiting state before the assistant has produced its next result. */
export function Thinking({ shopName }: { shopName: string }) {
  return (
    <p
      role="status"
      className="enter text-ink-3 flex items-center gap-2 text-[14px]"
    >
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bg-ink-3 size-1.5 animate-pulse rounded-full"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      Checking with {shopName}…
    </p>
  );
}

type ThreadProps = {
  widget: boolean;
  messages: UIMessage[];
  status: ChatStatus;
  shopName: string;
  inQuote: (offerId: string) => boolean;
  quoteBusy: boolean;
  onAdd: (offerId: string) => void;
  onViewQuote: () => void;
  error: string | null;
  onRetry: () => void;
  /** The shop has not answered the assistant's question yet. */
  waitingOnShop?: boolean;
};

/** A quiet line saying what the assistant just checked, so its work is visible. */
/**
 * The shop notes behind one answer. Several tools can attach the same notes, so
 * they are merged and shown once, where they first appear, as one sources entry
 * per answer.
 */
function answerKnowledge(parts: UIMessage["parts"]): { at: number; sources: GuideSource[] } | null {
  let at = -1;
  const byId = new Map<string, GuideSource>();
  parts.forEach((part, index) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return;
    const name = part.type.slice("tool-".length);
    if (name !== "read_shop_guide" && name !== "browse_catalog") return;
    const sources = (part.output as { sources?: GuideSource[] }).sources ?? [];
    if (sources.length && at < 0) at = index;
    for (const source of sources) byId.set(source.id, source);
  });
  return at < 0 ? null : { at, sources: [...byId.values()] };
}

function Receipt({ children }: { children: ReactNode }) {
  return <p className="assistant-receipt">{children}</p>;
}

/**
 * Text written before a later tool step, once a final answer follows (or while the
 * reply is still streaming). It is shown in place as a step line rather than as an
 * answer; if no answer ever follows, it is the answer.
 */
function interimText(parts: UIMessage["parts"], index: number, streaming: boolean): boolean {
  const toolAfter = parts.findIndex((part, at) => at > index && isToolUIPart(part));
  if (toolAfter === -1) return false;
  return streaming || parts.some((part, at) => at > toolAfter && part.type === "text" && part.text.trim().length > 0);
}

/** Folds back-to-back receipts into one quiet line, so finished steps read as one fact rather than a tool log. */
function joinReceipts(nodes: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (run.length)
      out.push(
        <p key={`receipts-${out.length}`} className="assistant-receipt">
          {run.flatMap((item, i) => (i ? [" · ", item] : [item]))}
        </p>,
      );
    run = [];
  };
  for (const node of nodes) {
    if (isValidElement<{ children: ReactNode }>(node) && node.type === Receipt)
      run.push(node.props.children);
    else if (run.length && isValidElement(node) && node.type === KnowledgeSources) {
      // Sources belong to the steps just above them, as with the catalog receipt.
      const steps = run; run = [];
      out.push(
        <div key={`receipts-${out.length}`}>
          <p className="assistant-receipt">{steps.flatMap((item, i) => (i ? [" · ", item] : [item]))}</p>
          {node}
        </div>,
      );
    } else if (node !== null && node !== undefined && node !== false) {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

/** The conversation. Offer cards and quote updates come from tool results the server produced, never from model prose. */
export function Thread({
  widget,
  messages,
  status,
  shopName,
  inQuote,
  quoteBusy,
  onAdd,
  onViewQuote,
  error,
  onRetry,
  waitingOnShop = false,
}: ThreadProps) {
  const last = messages.at(-1);
  // Between a finished step and the next words nothing else moves, so the live line stays up.
  const newest = last?.parts.findLast((p) => p.type !== "step-start");
  const waiting =
    status === "submitted" ||
    (status === "streaming" &&
      last?.role === "assistant" &&
      (!newest ||
        (isToolUIPart(newest) &&
          (newest.state === "output-available" ||
            newest.state === "output-error"))));

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {messages.map((message) =>
        sellerReplyOf(message) ? (
          <div
            key={message.id}
            className="enter bg-surface min-w-0 max-w-[620px] rounded-[14px] px-4 py-3.5 shadow-[0_0_0_1px_var(--color-line)]"
          >
            <p className="text-ink-2 mb-1 text-[13px] font-medium">
              From the shop
            </p>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">
              {sellerReplyOf(message)!.text}
            </p>
          </div>
        ) : message.role === "user" ? (
          <div key={message.id} className="enter flex justify-end">
            <p className="bg-sunken max-w-[88%] rounded-[14px] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message.parts
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("")}
            </p>
          </div>
        ) : (
          <div key={message.id} className="enter flex min-w-0 flex-col gap-4">
            <p className="text-ink-3 text-[13px]">{shopName} assistant</p>
            {joinReceipts(
              message.parts.map((part, index) => {
                if (part.type === "text") {
                  if (!part.text.trim()) return null;
                  // Text written before a later tool step stays where it was written, as a step line, so it never reads as a second answer.
                  if (interimText(message.parts, index, status === "streaming" && message === last))
                    return <p key={index} className="assistant-interim">{part.text}</p>;
                  return (
                    <AssistantAnswer
                      key={index}
                      text={part.text}
                      streaming={
                        status === "streaming" && message.id === last?.id
                      }
                    />
                  );
                }
                if (!isToolUIPart(part)) return null;
                // A step the assistant retried successfully in this turn is not news to the customer.
                if (
                  part.state === "output-error" &&
                  message.parts
                    .slice(index + 1)
                    .some(
                      (later) =>
                        later.type === part.type &&
                        isToolUIPart(later) &&
                        later.state === "output-available",
                    )
                )
                  return null;
                const name = part.type.slice("tool-".length);
                if (name === "search_store_products") {
                  if (part.state === "output-available") {
                    const out = part.output as StoreResult;
                    // No connected store is not news to the buyer.
                    if (out.status === "disconnected") return null;
                    return (
                      <Receipt key={index}>
                        {out.status === "ok"
                          ? `Checked ${out.host}: ${out.products.length} product${out.products.length === 1 ? "" : "s"}${out.hasMore ? "; more results available" : ""}`
                          : "Could not verify the connected store’s products"}
                      </Receipt>
                    );
                  }
                  return (
                    <Receipt key={index}>
                      {part.state === "output-error"
                        ? "Could not check the existing store"
                        : "Searching the existing store…"}
                    </Receipt>
                  );
                }
                if (name === "read_store_product") {
                  if (part.state === "output-available")
                    return (
                      <StoreProducts
                        key={index}
                        result={part.output as StoreResult}
                      />
                    );
                  return (
                    <Receipt key={index}>
                      {part.state === "output-error"
                        ? "Could not check the existing store"
                        : "Checking the existing store…"}
                    </Receipt>
                  );
                }
                if (name === "read_shop_guide") {
                  if (part.state === "output-available") {
                    const out = part.output as {
                      sources?: GuideSource[];
                      error?: string;
                    };
                    // No matching notes is nothing to show; returning null keeps neighbouring receipts on one line.
                    if (out.sources) {
                      const knowledge = answerKnowledge(message.parts);
                      return knowledge?.at === index ? (
                        <KnowledgeSources key={index} sources={knowledge.sources} />
                      ) : null;
                    }
                    return (
                      <Receipt key={index}>
                        {out.error ??
                          "Could not read the shop’s knowledge just now"}
                      </Receipt>
                    );
                  }
                  return (
                    <Receipt key={index}>
                      {part.state === "output-error"
                        ? "Could not read the shop’s knowledge just now"
                        : "Reading the shop’s knowledge…"}
                    </Receipt>
                  );
                }
                if (name === "show_shop_step") {
                  if (part.state === "output-available") {
                    const out = part.output as {
                      step?: ShopStep;
                      error?: string;
                    };
                    return out.step ? (
                      <ShopNextStep key={index} step={out.step} />
                    ) : (
                      <Receipt key={index}>
                        {out.error ?? "That shop link is no longer available"}
                      </Receipt>
                    );
                  }
                  return (
                    <Receipt key={index}>
                      {part.state === "output-error"
                        ? "Could not open that shop step"
                        : "Checking the shop’s next step…"}
                    </Receipt>
                  );
                }
                if (name === "browse_catalog") {
                  if (part.state === "output-available") {
                    const look = part.output as CatalogLook & {
                      sources?: GuideSource[];
                    };
                    const receipt = (
                      <Receipt key={index}>
                        {look.matchingFilters === 0
                          ? "Checked the shop's offers: none fit those limits"
                          : `Looked through ${look.narrowedBySearch ? `${look.offers.length} of ${look.matchingFilters}` : look.matchingFilters} offer${look.matchingFilters === 1 ? "" : "s"}`}
                      </Receipt>
                    );
                    // A bare receipt can join its neighbours on one line; knowledge sources keep their own block.
                    const knowledge = answerKnowledge(message.parts);
                    return knowledge?.at === index ? (
                      <div key={index}>
                        {receipt}
                        <KnowledgeSources sources={knowledge.sources} />
                      </div>
                    ) : (
                      receipt
                    );
                  }
                  if (part.state === "output-error")
                    return (
                      <Receipt key={index}>
                        Could not read the shop's offers just now
                      </Receipt>
                    );
                  return <Searching key={index} shopName={shopName} />;
                }
                if (
                  name === "show_offers" &&
                  part.state === "output-available"
                ) {
                  const shown = part.output as ShownOffers;
                  return shown.offers.length > 0 ? (
                    <ul
                      key={index}
                      aria-label="Offers the assistant suggests"
                      className="offer-row"
                    >
                      {shown.offers.map((offer) => (
                        <OfferCard
                          key={offer.id}
                          offer={offer}
                          inQuote={inQuote(offer.id)}
                          busy={quoteBusy}
                          onAdd={() => onAdd(offer.id)}
                        />
                      ))}
                    </ul>
                  ) : null;
                }
                if (name === "shop_terms" && part.state === "output-available")
                  return (
                    <Receipt key={index}>Read the shop&apos;s terms</Receipt>
                  );
                if (name === "ask_seller") {
                  if (part.state === "output-available") {
                    const out = part.output as {
                      question?: string;
                      error?: string;
                    };
                    if (out.error || !out.question)
                      return (
                        <Receipt key={index}>
                          Could not send your question to the shop
                        </Receipt>
                      );
                    return (
                      <ShopQuestionSent
                        key={index}
                        shopName={shopName}
                        question={out.question}
                        waiting={waitingOnShop}
                      />
                    );
                  }
                  if (part.state === "output-error")
                    return (
                      <Receipt key={index}>
                        Could not send your question to the shop
                      </Receipt>
                    );
                  return <Receipt key={index}>Asking {shopName}…</Receipt>;
                }
                if (name === "my_orders") {
                  if (part.state === "output-available")
                    return <Receipt key={index}>Checked your orders</Receipt>;
                  if (part.state === "output-error")
                    return (
                      <Receipt key={index}>
                        Could not read your orders just now
                      </Receipt>
                    );
                  return <Receipt key={index}>Looking up your orders…</Receipt>;
                }
                if (name === "check_payment") {
                  if (part.state === "output-available") {
                    const out = part.output as PaymentResultEvidence;
                    return (
                      <PaymentResult
                        key={index}
                        evidence={out}
                        widget={widget}
                      />
                    );
                  }
                  if (part.state === "output-error")
                    return (
                      <Receipt key={index}>
                        The payment check could not finish. Do not pay again
                        while the result is unknown.
                      </Receipt>
                    );
                  return <Receipt key={index}>Checking your payment…</Receipt>;
                }
                if (name === "restore_download") {
                  if (part.state === "output-available") {
                    const out = part.output as {
                      outcome?: string;
                      reason?: string;
                      error?: string;
                    };
                    const orderId = (
                      part.input as { orderId?: string } | undefined
                    )?.orderId;
                    if (out.outcome === "granted") {
                      return (
                        <div
                          key={index}
                          className="enter bg-surface border-line rounded-[14px] border px-4 py-3"
                        >
                          <p className="text-[16px] font-semibold">
                            Your download is ready again
                          </p>
                          {orderId ? (
                            <BuyerOrderLink orderId={orderId} widget={widget}>
                              Open your order to download
                            </BuyerOrderLink>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <Receipt key={index}>
                        {out.error ??
                          out.reason ??
                          "The download could not be restored yet."}
                      </Receipt>
                    );
                  }
                  if (part.state === "output-error")
                    return (
                      <Receipt key={index}>
                        Could not restore the download just now
                      </Receipt>
                    );
                  return (
                    <Receipt key={index}>Restoring your download…</Receipt>
                  );
                }
                if (
                  name === "check_seller_answer" &&
                  part.state === "output-available"
                ) {
                  const out = part.output as {
                    state?: string;
                    answer?: string | null;
                    quoteReview?: {
                      totalMinor: number | null;
                      currency: string;
                    } | null;
                  };
                  if (out.state === "answered" && out.answer) {
                    return (
                      <div
                        key={index}
                        className="enter bg-sunken rounded-[14px] px-4 py-3"
                      >
                        <p className="text-ink-3 text-[13px] font-medium">
                          {shopName} answered
                        </p>
                        <p className="mt-1 text-[15px] leading-snug">
                          {out.answer}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <Receipt key={index}>
                      {out.quoteReview
                        ? `Seller-reviewed quote: ${formatQuoteAmount(out.quoteReview.totalMinor, out.quoteReview.currency)}${out.state === "waiting" ? "; separate question still waiting" : ""}`
                        : out.state === "waiting"
                          ? `${shopName} has not answered your question yet`
                          : "No separate seller question"}
                    </Receipt>
                  );
                }
                if (name === "propose_quote") {
                  if (part.state === "output-available") {
                    const out = part.output as QuoteToolOutput;
                    if (
                      out.error ||
                      (typeof out.totalMinor !== "number" &&
                        out.totalMinor !== null)
                    )
                      return null;
                    const items = (out.lines ?? []).reduce(
                      (sum, line) => sum + line.quantity,
                      0,
                    );
                    return (
                      <div
                        key={index}
                        className="enter text-ink-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]"
                      >
                        <ReceiptText aria-hidden size={16} strokeWidth={1.75} />
                        <span>
                          Quote updated: {items}{" "}
                          {items === 1 ? "item" : "items"},{" "}
                          {formatQuoteAmount(
                            out.totalMinor,
                            out.currency ?? "USD",
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={onViewQuote}
                          className="lg:hidden"
                        >
                          View quote
                        </Button>
                      </div>
                    );
                  }
                  if (part.state === "output-error")
                    return (
                      <p key={index} className="text-ink-3 text-[14px]">
                        That change did not go through. Your quote is unchanged.
                      </p>
                    );
                  return (
                    <p
                      key={index}
                      role="status"
                      className="text-ink-3 text-[14px]"
                    >
                      Updating your quote…
                    </p>
                  );
                }
                return null;
              }),
            )}
          </div>
        ),
      )}
      {waiting ? <Thinking shopName={shopName} /> : null}
      {error ? (
        <Alert tone="danger" title={error}>
          <Button type="button" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
