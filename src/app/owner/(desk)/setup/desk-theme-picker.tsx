"use client";

import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { Alert } from "@/components/arc/alert/alert";
import {
  DESK_THEME_IDS,
  DESK_THEMES,
  type DeskThemeId,
} from "@/lib/desk-themes";
import { setDeskThemeAction } from "./actions";

/** The library cards show the actual saved theme colours; failed saves restore the previous choice. */
export function DeskThemePicker({ current }: { current: DeskThemeId }) {
  const [picked, setPicked] = useState(current);
  const save = useAction(setDeskThemeAction, {
    onError: () => setPicked(current),
  });
  useEffect(() => setPicked(current), [current]);
  return (
    <section
      id="desk-theme"
      aria-labelledby="desk-theme-heading"
      className="surface mt-8 scroll-mt-40 sm:scroll-mt-28 flex flex-col gap-4 px-5 py-6 sm:px-6"
    >
      <div>
        <h2 id="desk-theme-heading" className="text-[17px] font-semibold">
          Desk theme
        </h2>
        <p className="text-ink-2 mt-1 text-[14px]">
          Changes your desk immediately in this browser. Customer shop colours
          are separate, below.
        </p>
      </div>
      <fieldset disabled={save.isPending}>
        <RadioCards
          aria-label="Choose desk theme"
          minColumnWidth={150}
          disabled={save.isPending}
          name="desk-theme"
          value={picked}
          options={DESK_THEME_IDS.map((id) => ({
            value: id,
            label: DESK_THEMES[id].label,
            description: DESK_THEMES[id].description,
            meta: (
              <span aria-hidden="true" className="flex gap-1.5">
                {[
                  DESK_THEMES[id].canvas,
                  DESK_THEMES[id].surface,
                  DESK_THEMES[id].brand,
                ].map((colour, index) => (
                  <span
                    key={index}
                    className="size-6 rounded-md border border-line"
                    style={{ backgroundColor: colour }}
                  />
                ))}
              </span>
            ),
          }))}
          onValueChange={(value) => {
            const id = value as DeskThemeId;
            setPicked(id);
            save.execute({ theme: id });
          }}
        />
      </fieldset>
      <p role="status" className="text-ink-3 min-h-5 text-[13px]">
        {save.isPending
          ? "Saving desk theme…"
          : save.result.data
            ? "Desk theme saved."
            : "Saves when you choose a theme."}
      </p>
      {save.result.serverError ? (
        <Alert tone="danger" title="The theme was not saved. Try again." />
      ) : null}
    </section>
  );
}
