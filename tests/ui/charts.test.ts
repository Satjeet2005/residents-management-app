import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHART_TOKENS } from "@/components/charts/chart-tokens";
import type { ChartText } from "@/components/charts/chart-parts";
import { HorizontalBars, MAX_BARS } from "@/components/charts/horizontal-bars";
import { LineChart, MAX_SERIES } from "@/components/charts/line-chart";
import { ProgressBar } from "@/components/charts/progress-bar";
import { Sparkline } from "@/components/charts/sparkline";
import { StackedBars, wrapSeriesName } from "@/components/charts/stacked-bars";

const text = (id: string): ChartText => ({
  id,
  caption: `Caption of ${id}`,
  title: `Title of ${id}`,
  description: `Description of ${id}: the takeaway`,
  table: { caption: `Table of ${id}`, columns: ["Month", "Share", "Amount"], rows: [{ header: "September", cells: ["82%", "₹1,48,00,000"] }, { header: "October", cells: ["No data", "₹0"] }] },
});

const spark = h(Sparkline, { text: text("spark"), points: [{ label: "May", value: 50 }, { label: "Jun", value: null }, { label: "Jul", value: 80 }, { label: "Aug", value: 90 }], goal: { percent: 90, label: "Goal 90%" } });
const bars = h(HorizontalBars, { text: text("bars"), rows: [{ label: "Not yet due", valueText: "₹4.0 lakh", value: 400 }, { label: "Over 90 days", valueText: "₹1.0 lakh", value: 100, emphasis: "warning" }] });
const stacked = h(StackedBars, {
  text: text("stack"),
  labels: { collected: "Collected", outstanding: "Outstanding" },
  columns: [
    { label: "Aug", collected: 0, outstanding: 0, hasData: false, percentText: "No data" },
    { label: "Sep", collected: 80, outstanding: 20, hasData: true, percentText: "80%" },
    { label: "Oct", collected: 60, outstanding: 40, hasData: true, percentText: "60%" },
  ],
});
const line = h(LineChart, {
  text: text("line"),
  series: [{ label: "Collected", points: [{ x: 0, y: 0 }, { x: 5, y: 40 }, { x: 10, y: null }, { x: 15, y: 90 }] }],
  xMax: 45,
  xTicks: [{ x: 0, label: "0" }, { x: 45, label: "45" }],
  xLabel: "Days since the bill was issued",
  goal: { percent: 90, label: "Goal 90%" },
  marker: { x: 9, label: "Due day" },
});
const progress = h(ProgressBar, { text: text("prog"), percent: 82 });
const all: [string, ReturnType<typeof h>][] = [["ProgressBar", progress], ["Sparkline", spark], ["HorizontalBars", bars], ["StackedBars", stacked], ["LineChart", line]];

describe("CH1 every chart is a figure with a title, a description and a table", () => {
  it.each(all)("%s: <figure>, <figcaption>, <svg role=img> named by its title and description, and a 'See the numbers behind this chart' details", (_name, element) => {
    const out = renderToStaticMarkup(element);
    const id = /aria-labelledby="([a-z]+)-title \1-desc"/.exec(out)?.[1] as string;
    expect(id).toBeTruthy();
    expect(out).toMatch(/^<figure/);
    expect(out).toContain(`<figcaption`);
    expect(out).toContain(`<svg role="img"`);
    expect(out).toContain(`<title id="${id}-title">Title of ${id}</title>`);
    expect(out).toContain(`<desc id="${id}-desc">Description of ${id}: the takeaway</desc>`);
    expect(out).toContain("<details");
    expect(out).toContain("See the numbers behind this chart");
  });

  it.each(all)("%s: the table is a real table with a caption, column and row header scopes, and every value", (_name, element) => {
    const out = renderToStaticMarkup(element);
    expect(out).toMatch(/<table[^>]*>\s*<caption[^>]*>Table of /);
    expect(out.match(/<th scope="col"/g)).toHaveLength(3);
    expect(out.match(/<th scope="row"/g)).toHaveLength(2);
    for (const cell of ["82%", "₹1,48,00,000", "No data", "₹0"]) expect(out).toContain(`>${cell}</td>`);
  });

  it("the caption can be read but not shown when a card around the chart says it", () => {
    const out = renderToStaticMarkup(h(ProgressBar, { text: { ...text("hidden"), captionHidden: true }, percent: 10 }));
    expect(out).toMatch(/<figcaption class="[^"]*sr-only/);
  });
});

describe("CH2 direct labels, patterns and no interaction", () => {
  it("the goal label sits at the right end of the dashed line, outside the plot, and the line is drawn before (behind) the data", () => {
    const out = renderToStaticMarkup(line);
    const plotRight = Number(/<line x1="52" x2="(\d+)"/.exec(out)?.[1]);
    const label = /<text x="(\d+)"[^>]*>Goal 90%<\/text>/.exec(out);
    expect(Number(label?.[1])).toBeGreaterThan(plotRight);
    expect(out.indexOf('stroke-dasharray="8 5"')).toBeLessThan(out.indexOf("<polyline"));
    expect(Number(label?.[1])).toBeLessThan(560);
  });

  it("a series name is written to the right of its last point when it fits, so the line never runs under its own label, and right-aligned under the point when it does not", () => {
    const fits = renderToStaticMarkup(line);
    expect(fits).toMatch(/<text x="\d+(\.\d+)?" y="[\d.]+" font-size="14" font-weight="600" class="fill-ink">Collected 90%<\/text>/);
    const edge = renderToStaticMarkup(h(LineChart, { text: text("edge"), series: [{ label: "Replies", points: [{ x: 0, y: 40 }, { x: 10, y: 60 }] }], xMax: 10, xTicks: [], xLabel: "x", goal: null, marker: null }));
    expect(edge).toContain('text-anchor="end"');
  });

  it("a chart with value labels writes every value in one row above the plot, insets its points from the axes, and names a part-finished last point under its tick", () => {
    const weekly = renderToStaticMarkup(
      h(LineChart, {
        text: text("weekly"),
        series: [{ label: "Replies", points: [{ x: 0, y: 87 }, { x: 1, y: 81 }, { x: 2, y: 93 }], dots: true, valueLabels: true, partialIndex: 2, partialLabel: "this week so far" }],
        xMax: 2,
        xTicks: [{ x: 0, label: "7 Sep" }, { x: 2, label: "26 Oct" }],
        xLabel: "Week starting",
        goal: { percent: 90, label: "Goal 90%" },
        marker: null,
      }),
    );
    for (const value of ["87", "81", "93"]) expect(weekly).toMatch(new RegExp(`<text x="[\\d.]+" y="14" font-size="14" text-anchor="middle" class="fill-ink">${value}(<!-- -->)?%</text>`));
    expect(weekly).toContain(">this week so far</text>");
    expect(weekly).not.toMatch(/>Replies 93/);
    const firstX = Number(/<text x="([\d.]+)" y="14"/.exec(weekly)?.[1]);
    expect(firstX).toBeGreaterThan(52 + 14);
    expect(weekly).toContain('viewBox="0 0 560 318"');
  });

  it("a series name that does not fit beside the last column is written on two lines, and a short one stays on one", () => {
    expect(wrapSeriesName("Within 20 days")).toEqual(["Within 20 days"]);
    expect(wrapSeriesName("Not yet paid by day 20")).toEqual(["Not yet paid", "by day 20"]);
    const long = renderToStaticMarkup(h(StackedBars, { text: text("wrap"), labels: { collected: "Within 20 days", outstanding: "Not yet paid by day 20" }, columns: [{ label: "Oct", collected: 60, outstanding: 40, hasData: true, percentText: "60%" }] }));
    expect(long).toContain(">Not yet paid</tspan>");
    expect(long).toContain(">by day 20</tspan>");
    expect(long).toContain(">Within 20 days</text>");
  });

  it("the stacked bars name both series beside the last column and differ by a hatch pattern, with a percent over every column", () => {
    const out = renderToStaticMarkup(stacked);
    expect(out).toContain(">Collected</text>");
    expect(out).toContain(">Outstanding</text>");
    expect(out).toContain("<pattern");
    expect(out).toContain('fill="url(#stack-hatch)"');
    expect(out).toContain(">80%</text>");
    expect(out).toContain(">No data</text>");
  });

  it("the line chart writes the goal, the due-day marker and the series name with its last value, and the goal and marker are dashed differently", () => {
    const out = renderToStaticMarkup(line);
    expect(out).toContain(">Goal 90%</text>");
    expect(out).toContain(">Due day</text>");
    expect(out).toMatch(/>Collected <!-- -->90<!-- -->%<\/text>|>Collected 90%<\/text>/);
    expect(out).toContain('stroke-dasharray="8 5"');
    expect(out).toContain('stroke-dasharray="2 4"');
  });

  it("the sparkline writes its last value and the goal, and a gap breaks the line (no point for the null)", () => {
    const out = renderToStaticMarkup(spark);
    expect(out).toContain(">Goal 90%</text>");
    expect(out).toMatch(/>90<!-- -->%<\/text>|>90%<\/text>/);
    expect(out).toContain("<circle");
    expect(out.match(/<polyline/g) ?? []).toHaveLength(1);
  });

  it("the bars write each label and value, and a warning bar is hatched", () => {
    const out = renderToStaticMarkup(bars);
    for (const word of ["Not yet due", "₹4.0 lakh", "Over 90 days", "₹1.0 lakh"]) expect(out).toContain(`>${word}</text>`);
    expect(out).toContain('fill="url(#bars-hatch)"');
  });

  it.each(all)("%s: nothing to tap, hover or focus inside the picture, and no animation", (_name, element) => {
    const out = renderToStaticMarkup(element);
    const picture = /<svg[\s\S]*<\/svg>/.exec(out)?.[0] ?? "";
    expect(picture).not.toMatch(/<a[\s>]|<button|<input|onclick|tabindex|<animate|<set\b|<foreignObject/i);
    expect(out).not.toMatch(/transition|animation|hover:/);
  });

  it("no source file of the charts uses a hover, a transition or an animation class", () => {
    const dir = path.resolve(process.cwd(), "src/components/charts");
    for (const file of readdirSync(dir)) expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/hover:|transition|animate|onClick|onMouse|tabIndex/);
  });
});

describe("CH3 sizes", () => {
  it.each(all)("%s: every <text> is at least 14px and every stroke at least 2px", (_name, element) => {
    const out = renderToStaticMarkup(element);
    for (const tag of out.match(/<text[^>]*>/g) ?? []) expect(Number(/font-size="(\d+(?:\.\d+)?)"/.exec(tag)?.[1]), tag).toBeGreaterThanOrEqual(14);
    for (const width of out.match(/stroke-width="[\d.]+"/g) ?? []) expect(Number(/"([\d.]+)"/.exec(width)?.[1]), width).toBeGreaterThanOrEqual(2);
  });

  it("the table text is the 14px caption size or larger", () => {
    expect(renderToStaticMarkup(spark)).toMatch(/<table class="tnum[^"]*text-caption/);
  });
});

describe("CH4 limits", () => {
  it("at most seven bars: eight rows or columns throw", () => {
    const row = (n: number) => ({ label: `Row ${n}`, valueText: "1", value: 1 });
    expect(() => renderToStaticMarkup(h(HorizontalBars, { text: text("many"), rows: Array.from({ length: MAX_BARS }, (_, i) => row(i)) }))).not.toThrow();
    expect(() => renderToStaticMarkup(h(HorizontalBars, { text: text("many"), rows: Array.from({ length: MAX_BARS + 1 }, (_, i) => row(i)) }))).toThrow(RangeError);
    const column = (n: number) => ({ label: `M${n}`, collected: 1, outstanding: 1, hasData: true, percentText: "50%" });
    expect(() => renderToStaticMarkup(h(StackedBars, { text: text("many"), labels: { collected: "a", outstanding: "b" }, columns: Array.from({ length: MAX_BARS + 1 }, (_, i) => column(i)) }))).toThrow(RangeError);
  });

  it("at most three line series: four throw", () => {
    const one = (n: number) => ({ label: `S${n}`, points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] });
    const make = (n: number) => h(LineChart, { text: text("many"), series: Array.from({ length: n }, (_, i) => one(i)), xMax: 1, xTicks: [], xLabel: "x", goal: null, marker: null });
    expect(() => renderToStaticMarkup(make(MAX_SERIES))).not.toThrow();
    expect(() => renderToStaticMarkup(make(MAX_SERIES + 1))).toThrow(RangeError);
  });
});

describe("CH5 token colours", () => {
  const css = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
  const hexOf = (token: string): string => new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] as string;
  const luminance = (hex: string): number => {
    const channel = (i: number) => {
      const v = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each([...CHART_TOKENS])("%s has at least 3:1 contrast against the paper background", (token) => {
    expect(hexOf(token), token).toMatch(/^#/);
    expect(contrast(hexOf(token), hexOf("paper"))).toBeGreaterThanOrEqual(3);
  });

  it("the charts draw only with those tokens (and the paper itself)", () => {
    const dir = path.resolve(process.cwd(), "src/components/charts");
    const allowed = new Set<string>([...CHART_TOKENS, "paper", "none"]);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      for (const match of readFileSync(path.join(dir, file), "utf8").matchAll(/\b(?:fill|stroke)-([a-z0-9-]+)/g)) expect(allowed.has(match[1]), `${file}: ${match[0]}`).toBe(true);
    }
  });
});
