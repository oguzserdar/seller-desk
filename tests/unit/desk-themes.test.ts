import { describe, expect, it } from "vitest";
import { DESK_THEME_IDS, DESK_THEMES, deskThemeId, deskThemeStyle } from "../../src/lib/desk-themes";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe("owner desk themes", () => {
  it("offers the four themes measured from shipped products", () => {
    expect(DESK_THEME_IDS).toEqual(["mono", "olive", "graphite", "cash"]);
  });
  for (const id of DESK_THEME_IDS) {
    it(`${id}: text stays readable on every surface`, () => {
      const t = DESK_THEMES[id];
      expect(contrast(t.ink, t.surface)).toBeGreaterThanOrEqual(12);
      expect(contrast(t.ink2, t.surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.ink3, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.ink3, t.sunken)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.success, t.successSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.attention, t.attentionSoft)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("falls back to Mono for a missing or unknown choice", () => {
    expect(deskThemeId(undefined)).toBe("mono");
    expect(deskThemeId("purple")).toBe("mono");
    expect(deskThemeId("cash")).toBe("cash");
  });
  it("sets the app's colour tokens and the browser colour scheme", () => {
    const style = deskThemeStyle("graphite") as Record<string, string>;
    expect(style["--color-surface"]).toBe(DESK_THEMES.graphite.surface);
    expect(style.colorScheme).toBe("dark");
  });
});
