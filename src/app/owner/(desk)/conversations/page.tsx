import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Button } from "@/components/shadcn/button";
import { getEffectiveConfig } from "@/server/effective-config";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/server/auth/owner";
import {
  listSellerConversations,
  readSellerConversation,
} from "@/server/domain/conversation-messages";
import { DomainError } from "@/server/domain/errors";
import { openQuestions } from "@/server/domain/seller-questions";
import { cx } from "@/lib/cx";
import { CustomerConversation } from "./customer-conversation";
import { LocalTime } from "@/components/local-time";

const DAY_MONTH: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

export const metadata: Metadata = { title: "Conversations" };

/** Server-rendered inbox; all reads prove the authenticated owner's shop. */
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { owner } = await requireOwner(await headers());
  const requested = (await searchParams).conversation;
  if (requested && !z.uuid().safeParse(requested).success) notFound();
  const [listed, questions] = await Promise.all([listSellerConversations(owner), openQuestions(owner)]);
  // A customer waiting on the owner's answer comes first, whatever its age.
  const waiting = new Set(questions.map((question) => question.conversationId));
  // For a waiting customer, the useful line is what they asked, not the assistant's last reply.
  const asked = new Map(questions.map((question) => [question.conversationId, question.question]));
  const items = [...listed.filter((item) => waiting.has(item.id)), ...listed.filter((item) => !waiting.has(item.id))];
  const aiStatus = (await getEffectiveConfig()).ai.status;
  let selected = null;
  if (requested) {
    try {
      selected = await readSellerConversation(owner, requested);
    } catch (error) {
      if (error instanceof DomainError && error.code === "not_found")
        notFound();
      throw error;
    }
  }
  return (
    <section className="mx-auto max-w-[1280px] px-4 pt-7 pb-10 sm:px-8">
      <div className={cx(selected && "hidden lg:block")}>
        <h1 className="page-title">Conversations</h1>
        <p className="mt-1 text-ink-2">
          {waiting.size
            ? `${waiting.size} ${waiting.size === 1 ? "customer is" : "customers are"} waiting for your answer. They are listed first.`
            : "See what the customer needs. Step in when you can help."}
        </p>
      </div>
      {!items.length && !selected ? (
        <div className="mt-6">
          <EmptyState
            title="Your customer conversations start here"
            description={
              aiStatus === "ready"
                ? "New customer messages will appear here. Open your shop to try the buyer experience."
                : "Connect your assistant so customers can ask questions. Their conversations and requests will appear here."
            }
            icon={<MessageSquare size={24} aria-hidden />}
            action={
              <>
                <Button asChild>
                  <Link
                    href={
                      aiStatus === "ready"
                        ? "/buy"
                        : "/owner/setup#assistant"
                    }
                  >
                    {aiStatus === "ready"
                      ? "Open customer shop"
                      : "Connect assistant"}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/owner/install">Install on your website</Link>
                </Button>
              </>
            }
          />
        </div>
      ) : (
        <div className="mt-5 grid min-w-0 gap-7 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside
            className={cx(selected && "hidden lg:block")}
            aria-label="Customer conversations"
          >
            {items.length ? (
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/owner/conversations?conversation=${item.id}`}
                      aria-current={item.id === requested ? "page" : undefined}
                      className={cx(
                        "block min-h-20 rounded-lg p-3 hover:bg-sunken",
                        item.id === requested && "bg-sunken",
                      )}
                    >
                      <span className="flex items-center justify-between gap-3 text-[12px] text-ink-3">
                        {waiting.has(item.id) ? (
                          <span className="text-attention font-semibold">Waiting for your answer</span>
                        ) : (
                          <span>{item.handler === "seller" ? "With you" : "With assistant"}</span>
                        )}
                        <LocalTime value={item.updatedAt} options={DAY_MONTH} />
                      </span>
                      <p className="mt-2 line-clamp-3 text-[15px] leading-snug [overflow-wrap:anywhere]">
                        {asked.get(item.id) || item.preview || "Customer conversation"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-ink-2">
                Customer conversations appear here when someone sends a message.
              </p>
            )}
            {items.length === 50 ? (
              <p className="mt-4 text-[13px] text-ink-3">
                Showing the 50 most recently active conversations.
              </p>
            ) : null}
          </aside>
          {selected ? (
            <CustomerConversation
              key={selected.control.id}
              initial={selected}
            />
          ) : (
            <div className="hidden border-l border-line lg:block">
              <EmptyState
                title="Choose a conversation"
                description="Read the customer’s messages, review the assistant’s reply, or step in yourself."
                icon={<MessageSquare size={24} aria-hidden />}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
