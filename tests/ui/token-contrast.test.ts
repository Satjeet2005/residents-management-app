import { describe, expect, it } from "vitest";
import { colourTokens, contrast } from "./css-tokens";

const c = colourTokens();

describe("T1 token contrast (hex values read from globals.css)", () => {
  it("T1 the file defines every token of the design", () => {
    expect(Object.keys(c).sort()).toEqual(["accent", "caution", "control", "hairline", "ink", "ink-2", "paper", "paper-2", "white"]);
    expect(c.paper).toBe("#fbf8f1");
  });

  it.each(["ink", "ink-2", "accent", "caution", "control"])("T1 %s on paper is at least 4.5:1", (name) => {
    expect(contrast(c[name], c.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("T1 the hairline on paper is at least 3:1 (a line, not text)", () => {
    expect(contrast(c.hairline, c.paper)).toBeGreaterThanOrEqual(3);
  });

  it("T1 white on accent and paper on accent are at least 4.5:1", () => {
    expect(contrast(c.white, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.paper, c.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("T1 ink on paper-2 is at least 12:1 and ink-2 on paper-2 at least 4.5:1", () => {
    expect(contrast(c.ink, c["paper-2"])).toBeGreaterThanOrEqual(12);
    expect(contrast(c["ink-2"], c["paper-2"])).toBeGreaterThanOrEqual(4.5);
  });

  it("T1 the text colours that appear on paper-2 or paper (tags, notices) stay readable on both", () => {
    for (const name of ["ink", "ink-2", "accent", "caution", "control"]) expect(contrast(c[name], c["paper-2"]), name).toBeGreaterThanOrEqual(4.5);
  });

  it("T1 the contrast helper is right: black on white is 21:1 and a colour on itself is 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast(c.ink, c.ink)).toBe(1);
  });

  it("T1 the measured figures of the design hold (to two decimals)", () => {
    expect(contrast(c.ink, c.paper).toFixed(2)).toBe("16.37");
    expect(contrast(c["ink-2"], c.paper).toFixed(2)).toBe("7.38");
    expect(contrast(c.accent, c.paper).toFixed(2)).toBe("8.89");
    expect(contrast(c.caution, c.paper).toFixed(2)).toBe("6.59");
    expect(contrast(c.control, c.paper).toFixed(2)).toBe("5.46");
    expect(contrast(c.hairline, c.paper).toFixed(2)).toBe("3.41");
    expect(contrast(c.white, c.accent).toFixed(2)).toBe("9.43");
  });
});
