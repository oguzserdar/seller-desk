/**
 * AG Studio styled as part of the owner's desk: every value is one of the desk's own colour tokens,
 * so the dashboard follows the owner's chosen desk theme like every other page.
 */
import { studioTheme } from "ag-studio";

const v = (token: string) => `var(--color-${token})`;
const edge = (token: string) => ({ width: 1, color: v(token) });

// Brand first, then quiet companions. Hex, because the charts draw on canvas and read plain colours.
const PALETTE = ["#3653b0", "#2f9bb0", "#3d9a63", "#c79a3a", "#c4553f", "#7a5fa8"];
const palette = Object.fromEntries(
  PALETTE.flatMap((color, index) => [
    [`chartPaletteFills${index + 1}Color`, color],
    [`chartPaletteStrokes${index + 1}Color`, color],
  ]),
);

export const deskStudioTheme = studioTheme.withParams({
  fontFamily: "inherit",
  fontSize: 14,
  textColor: v("ink"),
  foregroundColor: v("ink"),
  subtleTextColor: v("ink-3"),
  backgroundColor: v("surface"),
  borderColor: v("line"),
  accentColor: v("brand"),
  iconColor: v("ink-2"),
  rowHoverColor: v("sunken"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: v("canvas"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: v("canvas"),
  studioCanvasPadding: 0,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: "inherit",

  studioWidgetBackgroundColor: v("surface"),
  studioWidgetBorder: edge("line"),
  studioWidgetBorderRadius: 14,
  // Studio maps this to the gutter round each card, not to padding inside it.
  studioWidgetPadding: 8,
  studioWidgetTitleFontFamily: "inherit",
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: v("ink"),
  studioWidgetSubtitleFontFamily: "inherit",
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: v("ink-3"),
  studioWidgetCaptionFontFamily: "inherit",
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: v("ink-3"),
  studioWidgetResizeBorderColor: v("brand"),

  studioPanelContainerBackgroundColor: v("surface"),
  studioPanelContainerBorder: edge("line"),
  studioPanelDividerColor: v("line"),
  studioPanelDividerActiveColor: v("brand"),
  studioPanelSectionBorderColor: v("line"),
  studioPanelHeaderFontFamily: "inherit",
  studioPanelHeaderFontWeight: 600,
  studioToggleButtonActiveBackgroundColor: v("brand-soft"),
  studioToggleButtonActiveBorderColor: v("brand"),
  studioToggleButtonActiveColor: v("brand"),

  gridFontFamily: "inherit",
  gridFontSize: 14,
  gridCellTextColor: v("ink"),
  gridHeaderBackgroundColor: v("surface"),
  gridHeaderTextColor: v("ink-2"),
  gridHeaderFontWeight: 500,
  gridHeaderFontSize: 13,
  gridRowHeight: 48,
  gridRowBorder: edge("line"),
  gridHeaderRowBorder: edge("line"),
  gridRowHoverColor: v("sunken"),
  gridWrapperBorder: false,

  chartFontFamily: "inherit",
  chartTextColor: v("ink"),
  chartSubtleTextColor: v("ink-3"),
  chartAxisLineColor: v("line"),
  chartGridLineColor: v("line"),
  ...palette,
});
