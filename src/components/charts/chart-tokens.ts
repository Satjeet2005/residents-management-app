/**
 * The colour tokens the charts draw with (src/app/globals.css). A test reads their hex values and checks every one against the paper background for at least 3:1
 * (WCAG 1.4.11, non-text contrast). Colour never carries a meaning alone: every mark has a direct label, and series differ by a pattern or a dash as well.
 */
export const CHART_TOKENS = ["ink", "ink-2", "accent", "caution", "control", "hairline"] as const;

/** The size every chart text has: 14px, the caption size of the design system. */
export const CHART_TEXT = 14;
/** The thinnest stroke a chart draws. */
export const CHART_STROKE = 2;
