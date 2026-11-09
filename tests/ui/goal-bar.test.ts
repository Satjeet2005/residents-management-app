import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalBar, clampPercent } from "@/components/charts/goal-bar";
import { colourTokens, contrast } from "./css-tokens";

const draw = (props: Parameters<typeof GoalBar>[0]) => renderToStaticMarkup(h(GoalBar, props));
const fillWidth = (markup: string) => /data-part="fill"[^>]*style="width:([\d.]+)%"/.exec(markup)?.[1];
const tickLeft = (markup: string) => /data-part="tick"[^>]*style="left:calc\(([\d.]+)% - 1px\)"/.exec(markup)?.[1];

describe("GB1 the goal bar", () => {
  it("is one image with the whole sentence as its label, and no text drawn on it", () => {
    const out = draw({ value: 70, goal: 90, direction: "higher", label: "70 percent. Goal 90 percent. 20 points short." });
    expect(out).toContain('role="img" aria-label="70 percent. Goal 90 percent. 20 points short."');
    expect(out.replace(/<[^>]*>/g, "")).toBe("");
  });

  it("fills to the value and puts the tick at exactly the goal, as a percentage of the track", () => {
    const out = draw({ value: 70, goal: 90, label: "x" });
    expect(fillWidth(out)).toBe("70");
    expect(tickLeft(out)).toBe("90");
    expect(tickLeft(draw({ value: 3, goal: 8, direction: "lower", label: "x" }))).toBe("8");
  });

  it("the direction does not move the tick: a limit is drawn where it is", () => {
    expect(tickLeft(draw({ value: 12, goal: 8, direction: "lower", label: "x" }))).toBe(tickLeft(draw({ value: 12, goal: 8, direction: "higher", label: "x" })));
  });

  it("a goal equal to the value draws the fill edge and the tick at the same place", () => {
    const out = draw({ value: 90, goal: 90, label: "x" });
    expect(fillWidth(out)).toBe(tickLeft(out));
  });

  it("clamps a value or goal outside 0 to 100 for drawing only", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(fillWidth(draw({ value: 140, goal: 90, label: "140 percent." }))).toBe("100");
    expect(fillWidth(draw({ value: -5, goal: 90, label: "x" }))).toBe("0");
    expect(tickLeft(draw({ value: 50, goal: 120, label: "x" }))).toBe("100");
    expect(draw({ value: 140, goal: 90, label: "140 percent." })).toContain('aria-label="140 percent."');
  });

  it("has no value (No data): an empty track, and the tick still marks the goal", () => {
    const out = draw({ value: null, goal: 90, label: "No data." });
    expect(fillWidth(out)).toBe("0");
    expect(tickLeft(out)).toBe("90");
  });

  it("without a goal there is no tick: a plain progress bar", () => {
    expect(draw({ value: 82, label: "82 percent." })).not.toContain('data-part="tick"');
  });

  it("the fill is the accent and the tick is ink, and both have at least 3:1 contrast against the paper", () => {
    const out = draw({ value: 70, goal: 90, label: "x" });
    expect(out).toContain("bg-accent");
    expect(out).toContain("bg-ink");
    const tokens = colourTokens();
    for (const token of ["accent", "ink"]) expect(contrast(tokens[token], tokens.paper), token).toBeGreaterThanOrEqual(3);
  });

  it("the track is 12px high and the tick is a 2px line", () => {
    const out = draw({ value: 1, goal: 2, label: "x" });
    expect(out).toContain("h-3 ");
    expect(out).toContain("w-0.5");
    expect(readFileSync(path.resolve(process.cwd(), "src/components/charts/goal-bar.tsx"), "utf8")).not.toMatch(/<text|fontSize/);
  });
});
