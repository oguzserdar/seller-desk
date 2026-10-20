"use client";

/**
 * Adapted from Vercel AI Elements, Apache-2.0. Copyright 2023 Vercel, Inc.
 * Modified: narrow picker API, direct Radix Popover/cmdk composition, original Seller Desk UI.
 * Source pin and license: third-party/ai-elements/NOTICE and LICENSE.
 */
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";

/** Public labels and searchable values only. Never put credentials in picker data. */
export type ModelChoice = {
  id: string;
  label: string;
  description: string;
  group: string;
};

/** Searchable AI Elements picker with anchored positioning, keyboard selection and mobile bounds. */
export function ModelSelector({
  title,
  value,
  label,
  description,
  choices,
  onSelect,
}: {
  title: string;
  value: string;
  label: string;
  description: string;
  choices: readonly ModelChoice[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const triggerRef = useCallback((node: HTMLButtonElement | null) => {
    if (node)
      setPortalContainer(node.closest<HTMLElement>(".desk-theme, .buyer-page"));
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = [...new Set(choices.map((item) => item.group))];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        ref={triggerRef}
        className="ai-picker-trigger"
        aria-label={`${title}: ${label}`}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[15px] font-semibold">
            {label}
          </span>
          <span className="text-ink-3 mt-0.5 block truncate text-[13px]">
            {description}
          </span>
        </span>
        <ChevronsUpDown size={16} className="text-ink-3 shrink-0" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal container={portalContainer ?? undefined}>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="ai-picker-popover"
          aria-label={title}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <Command
            label={title}
            defaultValue={value}
            loop
            className="flex min-h-0 flex-col"
          >
            <div className="border-line flex items-center gap-3 border-y px-5">
              <Search size={17} className="text-ink-3 shrink-0" aria-hidden />
              <Command.Input
                ref={searchRef}
                aria-label={`Search ${title.toLowerCase()}`}
                placeholder="Search by name…"
                className="h-13 w-full min-w-0 bg-transparent text-[16px] outline-none!"
              />
            </div>
            <Command.List className="ai-picker-list">
              <Command.Empty className="text-ink-2 px-5 py-8 text-center text-[14px]">
                No matches. Try a different name.
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group} heading={group}>
                  {choices
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <Command.Item
                        key={item.id}
                        value={item.id}
                        keywords={[item.label, item.description]}
                        onSelect={() => {
                          onSelect(item.id);
                          setOpen(false);
                        }}
                        className="ai-picker-option"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium">
                            {item.label}
                          </span>
                          <span className="text-ink-3 mt-1 block text-[13px] leading-snug">
                            {item.description}
                          </span>
                        </span>
                        {item.id === value ? (
                          <Check
                            size={18}
                            className="text-brand shrink-0"
                            aria-label="Chosen"
                          />
                        ) : null}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
