"use client";

/**
 * Adapted from Vercel AI Elements, Apache-2.0. Copyright 2023 Vercel, Inc.
 * Modified: scoped API, original appearance, instant motion and accessible scroll control.
 * Source pin and license: third-party/ai-elements/NOTICE and LICENSE.
 */
import { Button } from "@/components/arc/button/button";
import { ArrowDown } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

/** Internal conversation primitive. The reader can leave bottom-follow mode by scrolling up. */
export function Conversation({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <StickToBottom
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      initial="instant"
      resize="instant"
      role="log"
      aria-label={label}
    >
      {children}
    </StickToBottom>
  );
}

/** Internal content primitive; scrolling belongs to the conversation, not the page. */
export function ConversationContent({ children }: { children: ReactNode }) {
  return (
    <StickToBottom.Content
      scrollClassName="conversation-scroll"
      className="conversation-content"
    >
      {children}
    </StickToBottom.Content>
  );
}

/** Offers an explicit return to the newest answer without moving someone reading history. */
export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return !isAtBottom ? (
    <div className="conversation-latest">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shadow-md"
        onClick={() => void scrollToBottom({ animation: "instant" })}
      >
        <ArrowDown aria-hidden size={15} /> Latest reply
      </Button>
    </div>
  ) : null;
}

/** Sending a message returns the reader to the newest reply and resumes following it, as chat apps do. */
export function ConversationFollowOnSend({ sending }: { sending: boolean }) {
  const { scrollToBottom } = useStickToBottomContext();
  useEffect(() => {
    if (sending) void scrollToBottom({ animation: "instant" });
  }, [sending, scrollToBottom]);
  return null;
}
