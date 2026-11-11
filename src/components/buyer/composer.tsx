"use client";

import { ChatComposer } from "@/components/arc/chat-thread/chat-thread";

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
    <div data-buyer-composer>
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
        onStop={onStop}
        placeholder={placeholder}
      />
    </div>
  );
}
