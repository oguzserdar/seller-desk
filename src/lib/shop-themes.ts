/**
 * The shop colours a seller can choose. Each palette sets only the shop's band
 * and its action colour; meaning colours (verified, waiting, problem) stay fixed
 * so "paid" looks the same in every shop. Every pair below was checked: band
 * text at least 12:1, secondary band text at least 8:1, white on the action
 * colour at least 7:1. Action colours stay at least 20 degrees of hue away from
 * the problem red, so a shop button never reads as a warning.
 */
import type { CSSProperties } from "react";

export const SHOP_THEME_IDS = ["slate", "spruce", "brick", "ink", "plum"] as const;
export type ShopThemeId = (typeof SHOP_THEME_IDS)[number];

type Palette = { label: string; description: string; band: string; bandInk2: string; bandLine: string; brand: string; brandStrong: string; brandSoft: string; swatch: [string, string] };

export const SHOP_THEMES: Record<ShopThemeId, Palette> = {
  slate: { label: "Slate", description: "Calm blue-grey", band: "oklch(27% 0.045 258)", bandInk2: "oklch(82% 0.02 258)", bandLine: "oklch(40% 0.04 258)", brand: "oklch(45% 0.14 262)", brandStrong: "oklch(38% 0.14 262)", brandSoft: "oklch(95.6% 0.025 262)", swatch: ["#18273c", "#2750a2"] },
  spruce: { label: "Spruce", description: "Deep blue-green", band: "oklch(29% 0.05 190)", bandInk2: "oklch(84% 0.03 190)", bandLine: "oklch(42% 0.045 190)", brand: "oklch(44% 0.08 195)", brandStrong: "oklch(37% 0.08 195)", brandSoft: "oklch(95.5% 0.025 195)", swatch: ["#003331", "#006060"] },
  brick: { label: "Brick", description: "Warm clay brown", band: "oklch(33% 0.07 48)", bandInk2: "oklch(86% 0.03 48)", bandLine: "oklch(45% 0.06 48)", brand: "oklch(45% 0.11 50)", brandStrong: "oklch(38% 0.11 50)", brandSoft: "oklch(95.8% 0.025 50)", swatch: ["#522912", "#843f0f"] },
  ink: { label: "Ink", description: "Near-black", band: "oklch(21% 0.006 258)", bandInk2: "oklch(80% 0.006 258)", bandLine: "oklch(34% 0.008 258)", brand: "oklch(26% 0.01 258)", brandStrong: "oklch(18% 0.01 258)", brandSoft: "oklch(95.5% 0.004 258)", swatch: ["#17181b", "#212429"] },
  plum: { label: "Plum", description: "Deep aubergine", band: "oklch(29% 0.06 330)", bandInk2: "oklch(84% 0.03 330)", bandLine: "oklch(42% 0.055 330)", brand: "oklch(45% 0.12 330)", brandStrong: "oklch(38% 0.12 330)", brandSoft: "oklch(95.7% 0.025 330)", swatch: ["#3c1f39", "#793974"] },
};

/** CSS variables that re-colour a shop's pages; anything else reads the shared tokens. */
export function shopThemeStyle(theme: string | null | undefined): CSSProperties {
  const palette = SHOP_THEMES[(SHOP_THEME_IDS as readonly string[]).includes(theme ?? "") ? (theme as ShopThemeId) : "slate"];
  return {
    "--color-band": palette.band, "--color-band-ink-2": palette.bandInk2, "--color-band-line": palette.bandLine,
    "--color-brand": palette.brand, "--color-brand-strong": palette.brandStrong, "--color-brand-soft": palette.brandSoft,
  } as CSSProperties;
}
