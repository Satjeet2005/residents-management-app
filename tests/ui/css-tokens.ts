import { readFileSync } from "node:fs";
import path from "node:path";

export const GLOBALS_CSS = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** The colour tokens of globals.css: { paper: "#fbf8f1", ... }, read from the file so the CSS and the tests cannot drift apart. */
export function colourTokens(css: string = GLOBALS_CSS): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[match[1]] = match[2];
  return tokens;
}

/** WCAG 2.x relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
