"use client";

/**
 * Adapted from Vercel AI Elements' MessageActions and MessageAction, Apache-2.0. Copyright 2023 Vercel, Inc.
 * Modified: Seller Desk tokens and a single copy action that confirms in place.
 * Source pin and license: third-party/ai-elements/NOTICE and LICENSE.
 */
import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** The row of small actions under a finished answer. */
export function MessageActions({ children }: { children: ReactNode }) {
  return <div className="chat-actions">{children}</div>;
}

/** Text an answer's copy action puts on the clipboard: its written parts, in order, without blank edges. */
export function answerText(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .filter((part) => part.type === "text" && part.text?.trim())
    .map((part) => part.text!.trim())
    .join("\n\n");
}

/** Copies an answer and shows a check for two seconds, as AI Elements' chatbot example does. */
export function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="chat-action"
      aria-label={copied ? "Copied" : "Copy answer"}
      title={copied ? "Copied" : "Copy answer"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
      }}
    >
      {copied ? <Check size={15} strokeWidth={2} aria-hidden /> : <Copy size={15} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
