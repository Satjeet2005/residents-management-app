import { describe, expect, it } from "vitest";
import { type Stroke, type TextItem, overlapFailures } from "../e2e/helpers/overlap-rules";

const text = (value: string, x: number, y: number, w: number, h = 16, node = 0): TextItem => ({ text: value, x, y, w, h, node, clipped: false });
const container = { x: 0, y: 0, w: 300, h: 200 };
const hline = (label: string, x1: number, x2: number, y: number): Stroke => ({ label, points: Array.from({ length: Math.ceil((x2 - x1) / 3) + 1 }, (_, i) => ({ x: Math.min(x2, x1 + i * 3), y })) });

describe("OV1 the text-overlap rules", () => {
  it("two texts that intersect fail, and the message names both", () => {
    const failures = overlapFailures([text("Goal 90%", 10, 10, 60, 16, 1), text("70%", 40, 14, 40, 16, 2)], [], container);
    expect(failures).toHaveLength(1);
    expect(failures[0].check).toBe("text overlap");
    expect(failures[0].detail).toContain('"Goal 90%"');
    expect(failures[0].detail).toContain('"70%"');
  });

  it("texts that only touch, or sit side by side, pass; so do the lines of one wrapped paragraph", () => {
    expect(overlapFailures([text("a", 10, 10, 40, 16, 1), text("b", 50, 10, 40, 16, 2)], [], container)).toEqual([]);
    expect(overlapFailures([text("line one", 10, 10, 100, 20, 1), text("line one", 10, 20, 100, 20, 1)], [], container)).toEqual([]);
  });

  it("a text crossed by a drawn line fails, and a line below it passes", () => {
    const label = text("Goal 90%", 32, 14, 62, 16);
    expect(overlapFailures([label], [hline("the dashed goal line", 32, 172, 22)], container)).toEqual([{ check: "text on a line", detail: '"Goal 90%" is crossed by the dashed goal line' }]);
    expect(overlapFailures([label], [hline("the baseline", 32, 172, 40)], container)).toEqual([]);
  });

  it("a text outside its container, and a text cut by a clipping ancestor, fail", () => {
    expect(overlapFailures([text("far", 290, 10, 40)], [], container).map((f) => f.check)).toEqual(["text outside"]);
    expect(overlapFailures([{ ...text("cut", 10, 10, 40), clipped: true }], [], container).map((f) => f.check)).toEqual(["text clipped"]);
  });

  it("would have failed on the old headline card: the sparkline's 'Goal 90%' sat on the 100% line and the dashed goal line", () => {
    // The old Sparkline (224 x 104 units, LEFT 32, RIGHT 52, TOP 26, BOTTOM 28): the 100 line at y 26, the goal line at y 31, the label's baseline 6 above the goal line.
    const failures = overlapFailures([text("Goal 90%", 32, 14, 62, 17)], [hline("the 100 percent line", 32, 172, 26), hline("the dashed goal line", 32, 172, 31)], { x: 0, y: 0, w: 224, h: 104 });
    expect(failures.map((f) => f.detail)).toEqual(['"Goal 90%" is crossed by the 100 percent line']);
  });

  it("passes the new layout: the goal label at the right end of the line, outside the plot, with no line through it", () => {
    expect(overlapFailures([text("Goal 90%", 484, 44, 62, 17)], [hline("the dashed goal line", 52, 476, 50)], { x: 0, y: 0, w: 560, h: 300 })).toEqual([]);
  });
});
