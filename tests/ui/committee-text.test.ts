import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_TEXT } from "@/components/charts/chart-tokens";
import { GLOBALS_CSS, colourTokens, contrast } from "./css-tokens";

const REPORT_DIR = path.resolve(process.cwd(), "src/app/(staff)/staff/reports");
const CHARTS_DIR = path.resolve(process.cwd(), "src/components/charts");
const sources = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => ({ file: f, text: readFileSync(path.join(dir, f), "utf8") }));
const reportSources = sources(REPORT_DIR);
const colours = colourTokens();
const px = (token: string): number => Number(new RegExp(`--text-${token}:\\s*(\\d+)px`).exec(GLOBALS_CSS)?.[1]);

/** The narrowest content width at 360px: the page's 16px sides, the section's 16px padding and its 1px borders (the card has the same). */
const NARROWEST_CONTENT = 360 - 2 * 16 - 2 * 16 - 2;

describe("TX1 text size and contrast of the committee report (D181)", () => {
  it("body text is at least 16px and every small line at least 14px, with the line heights of the design", () => {
    expect(px("body")).toBeGreaterThanOrEqual(16);
    expect(px("caption")).toBeGreaterThanOrEqual(14);
    expect(GLOBALS_CSS).toMatch(/--text-body--line-height:\s*1\.5/);
    expect(GLOBALS_CSS).toMatch(/--text-caption--line-height:\s*1\.5/);
  });

  it("the report uses only the sizes of the design: no arbitrary text size and nothing under 14px", () => {
    for (const { file, text } of reportSources) {
      expect(text, file).not.toMatch(/text-\[/);
      for (const match of text.matchAll(/\btext-(caption|body|title|heading|hero)\b/g)) expect(px(match[1]), `${file} ${match[0]}`).toBeGreaterThanOrEqual(14);
      expect(text, file).not.toMatch(/\btext-(xs|sm)\b/);
    }
  });

  it("every colour the report sets text in meets 4.5:1 on the paper and on the tint", () => {
    const used = new Set<string>();
    for (const { text } of reportSources) for (const match of text.matchAll(/\btext-(ink-2|ink|accent|caution|control)\b/g)) used.add(match[1]);
    expect(used.has("ink-2")).toBe(true);
    for (const name of used) {
      expect(contrast(colours[name], colours.paper), `${name} on paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colours[name], colours["paper-2"]), `${name} on paper-2`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the small grey text is the darkened one: at least 9:1 on the paper", () => {
    expect(contrast(colours["ink-2"], colours.paper)).toBeGreaterThanOrEqual(9);
  });

  it("the goal line is set in the size of the card text, not the small size", () => {
    const goal = reportSources.find((s) => s.file === "goal-mark.tsx")?.text ?? "";
    expect(goal).toMatch(/text-body text-ink-2/);
    expect(goal).not.toMatch(/text-caption/);
  });

  it("the text of a chart is 14px, and the charts shown on a phone are drawn no wider than the phone's content, so they are never scaled down below 14px", () => {
    expect(CHART_TEXT).toBeGreaterThanOrEqual(14);
    for (const file of ["horizontal-bars.tsx"]) {
      const width = Number(/const WIDTH = (\d+);/.exec(readFileSync(path.join(CHARTS_DIR, file), "utf8"))?.[1]);
      expect(width, file).toBeLessThanOrEqual(NARROWEST_CONTENT);
    }
    expect(sources(CHARTS_DIR).length).toBeGreaterThan(4);
  });
});
