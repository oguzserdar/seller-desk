/**
 * Adapted from Vercel AI Elements' Message and MessageContent, Apache-2.0. Copyright 2023 Vercel, Inc.
 * Modified: Seller Desk tokens, an optional role label, and a card variant for the shop's own replies.
 * Source pin and license: third-party/ai-elements/NOTICE and LICENSE.
 *
 * Every chat surface (shop, desk assistant, owner conversation) renders its turns through these, so
 * a customer message, an answer and a label look the same everywhere.
 */
import type { ReactNode } from "react";

/** The turns of one conversation, evenly spaced. */
export function MessageList({ children }: { children: ReactNode }) {
  return <div className="chat-list">{children}</div>;
}

/**
 * One turn. `bubble` is a person's own words in a filled bubble; `answer` is the assistant's reply,
 * flat, as AI Elements renders it; `card` is a reply the shop owner wrote, outlined.
 */
export function Message({
  variant,
  align = "start",
  label,
  children,
}: {
  variant: "bubble" | "answer" | "card";
  /** The person typing on this screen sits at the end; everyone else at the start. */
  align?: "start" | "end";
  /** Who wrote it, when the screen shows more than two parties. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="chat-message enter" data-align={align}>
      {label ? <p className="chat-label">{label}</p> : null}
      {variant === "answer" ? <div className="chat-answer">{children}</div> : <div className={variant === "card" ? "chat-card" : "chat-bubble"}>{children}</div>}
    </div>
  );
}
