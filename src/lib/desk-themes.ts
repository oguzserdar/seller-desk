/**
 * The owner desk's themes. Each palette is measured from a shipped product
 * (Midday and Intercom for Mono, Granola for Olive, Linear for Graphite,
 * Cash App for Cash) and sets the app's colour tokens; Arc components read
 * those through the mapping in globals.css. Meaning colours keep their roles:
 * green only for verified records, amber for work waiting on the owner.
 */
import type { CSSProperties } from "react";

export const DESK_THEME_IDS = ["mono", "olive", "graphite", "cash"] as const;
export type DeskThemeId = (typeof DESK_THEME_IDS)[number];

/** The cookie that stores an owner's chosen theme on this browser. */
export const DESK_THEME_COOKIE = "sd-desk-theme";

type DeskTheme = {
  label: string; description: string; scheme: "light" | "dark";
  canvas: string; surface: string; sunken: string; photo: string;
  ink: string; ink2: string; ink3: string; line: string; lineStrong: string;
  brand: string; brandStrong: string; brandSoft: string; onBrand: string;
  success: string; successSoft: string; successLine: string;
  attention: string; attentionSoft: string; danger: string; dangerSoft: string;
};

export const DESK_THEMES: Record<DeskThemeId, DeskTheme> = {
  mono: {
    label: "Mono", description: "White with black ink", scheme: "light",
    canvas: "#f7f7f7", surface: "#ffffff", sunken: "#f1f1f1", photo: "#ececec",
    ink: "#0a0a0a", ink2: "#4f4f4f", ink3: "#6b6b6b", line: "#e3e3e3", lineStrong: "#cfcfcf",
    brand: "#0a0a0a", brandStrong: "#000000", brandSoft: "#efefef", onBrand: "#ffffff",
    success: "#15703a", successSoft: "#e8f5ec", successLine: "#bfe3cb",
    attention: "#9a4a0c", attentionSoft: "#fdf1e4", danger: "#b42318", dangerSoft: "#fdecea",
  },
  olive: {
    label: "Olive", description: "White with olive green", scheme: "light",
    canvas: "#f6f6f3", surface: "#ffffff", sunken: "#efefe9", photo: "#e9e9e2",
    ink: "#151510", ink2: "#4d4e44", ink3: "#686a5e", line: "#e2e2dc", lineStrong: "#cdcec4",
    brand: "#4b5717", brandStrong: "#3a4411", brandSoft: "#eef0e3", onBrand: "#f8faef",
    success: "#3b6418", successSoft: "#ebf3e1", successLine: "#c9ddb3",
    attention: "#8f470b", attentionSoft: "#fbefe2", danger: "#a9261b", dangerSoft: "#fbebe9",
  },
  graphite: {
    label: "Graphite", description: "Near-black, white text", scheme: "dark",
    canvas: "#08090a", surface: "#141517", sunken: "#1b1c1f", photo: "#1f2023",
    ink: "#f2f3f4", ink2: "#b4b8bf", ink3: "#8a8f98", line: "#26282c", lineStrong: "#36383d",
    brand: "#f2f3f4", brandStrong: "#ffffff", brandSoft: "#1f2124", onBrand: "#08090a",
    success: "#5fd39b", successSoft: "#12261c", successLine: "#1f4a33",
    attention: "#f3b16e", attentionSoft: "#2a1d10", danger: "#ff8a80", dangerSoft: "#2c1414",
  },
  cash: {
    label: "Cash", description: "Black with electric green", scheme: "dark",
    canvas: "#000000", surface: "#111111", sunken: "#181818", photo: "#1c1c1c",
    ink: "#ffffff", ink2: "#bdbdbd", ink3: "#8f8f8f", line: "#242424", lineStrong: "#333333",
    brand: "#00c244", brandStrong: "#00d64f", brandSoft: "#0d2416", onBrand: "#000000",
    success: "#2ee06f", successSoft: "#0b2214", successLine: "#145c2f",
    attention: "#ffbf47", attentionSoft: "#2a1f08", danger: "#ff7a6b", dangerSoft: "#2c1310",
  },
};

/** A stored choice, or Mono when it is missing or no longer offered. */
export function deskThemeId(value: string | null | undefined): DeskThemeId {
  return (DESK_THEME_IDS as readonly string[]).includes(value ?? "") ? (value as DeskThemeId) : "mono";
}

/** CSS variables for one theme, applied on the owner area's wrapper. */
export function deskThemeStyle(id: DeskThemeId): CSSProperties {
  const t = DESK_THEMES[id];
  return {
    colorScheme: t.scheme,
    "--color-canvas": t.canvas, "--color-surface": t.surface, "--color-sunken": t.sunken, "--color-photo": t.photo,
    "--color-ink": t.ink, "--color-ink-2": t.ink2, "--color-ink-3": t.ink3, "--color-line": t.line, "--color-line-strong": t.lineStrong,
    "--color-brand": t.brand, "--color-brand-strong": t.brandStrong, "--color-brand-soft": t.brandSoft, "--color-on-brand": t.onBrand,
    "--color-success": t.success, "--color-success-soft": t.successSoft, "--color-success-line": t.successLine,
    "--color-attention": t.attention, "--color-attention-soft": t.attentionSoft, "--color-danger": t.danger, "--color-danger-soft": t.dangerSoft,
    "--color-fixture": t.ink2, "--color-fixture-soft": t.sunken,
  } as CSSProperties;
}
