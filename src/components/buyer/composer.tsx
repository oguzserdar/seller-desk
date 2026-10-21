"use client";

import { Square } from "lucide-react";
import { ChatComposer } from "@/components/arc/chat-thread/chat-thread";
import { Button } from "@/components/arc/button/button";

/** Connects Arc's actual composer and stop control to the live buyer conversation. */
export function Composer({
  shopName,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  autoFocus = false,
}: {
  shopName: string;
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ChatComposer
        onSend={({ text }) => {
          if (!disabled && !streaming) onSend(text);
        }}
        allowAttachments={false}
        maxLength={4000}
        ariaLabel={`Ask ${shopName}`}
        autoFocus={autoFocus}
        disabled={disabled}
        // A disabled box drops keyboard focus; while streaming it stays editable and only sending waits.
        holdSend={streaming}
        placeholder={placeholder}
      />
      {streaming ? (
        <Button
          type="button"
          variant="secondary"
          onClick={onStop}
          aria-label="Stop the reply"
          className="self-end"
        >
          <Square aria-hidden size={14} /> Stop reply
        </Button>
      ) : null}
    </div>
  );
}
