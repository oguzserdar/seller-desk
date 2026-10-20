"use client";

import { MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/arc/bottom-sheet/bottom-sheet";
import { Button } from "@/components/arc/button/button";
import { DeskAssistant } from "./desk-assistant";

/** Mobile access to the desk assistant through Arc's documented sheet. */
export function MobileAssistant({ assistantOn }: { assistantOn: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(anchor.current?.closest<HTMLElement>(".desk-theme") ?? null);
  }, []);
  return (
    <div ref={anchor} className="lg:hidden">
      <BottomSheet
        portalContainer={container}
        open={open}
        onOpenChange={setOpen}
        title="Ask your desk"
        detents={[0.85]}
        trigger={
          <Button type="button">
            <MessageSquareText aria-hidden size={18} />
            Ask your desk
          </Button>
        }
      >
        <DeskAssistant assistantOn={assistantOn} active={open} />
      </BottomSheet>
    </div>
  );
}
