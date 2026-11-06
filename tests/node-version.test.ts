import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * D91: the Node 24 line on Vercel. Vercel maps an open range such as ">=24" to the newest Node it offers (26.x), and only
 * major versions exist there, so engines.node must name the 24 line. Source:
 * https://vercel.com/docs/functions/runtimes/node-js/node-js-versions (last updated 2026-02-27): "24.x" and "^24.0.0"
 * deploy the latest 24.x; "26.x", "^26.0.0" and ">=22.0.0" deploy the latest 26.x.
 */
const MAJOR = 24;

/** True for a range that can only ever mean Node 24: 24.x, 24.15.x, 24.15.0, ^24.0.0, ~24.15.0. */
function isNode24Line(range: string): boolean {
  return new RegExp(`^[\\^~]?${MAJOR}(\\.(x|\\d+)){0,2}$`).test(range.trim());
}

describe("D91 Node version pin", () => {
  it.each(["24.x", "24.15.x", "24.15.0", "^24.0.0", "~24.15.0", "24"])("accepts %s", (range) => {
    expect(isNode24Line(range)).toBe(true);
  });

  it.each([">=24", ">=22.0.0", "*", "", "25.x", "26.x", "^26.0.0", "24 || 25", ">=24 <25", "<=26", "latest", "^25.0.0", "24.x || 26.x", "v24"])("rejects %j", (range) => {
    expect(isNode24Line(range)).toBe(false);
  });

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines?: { node?: string } };
  const nvmrc = readFileSync(".nvmrc", "utf8").trim();

  it("package.json engines.node names the 24 line, so Vercel cannot choose Node 25 or newer", () => {
    expect(pkg.engines?.node).toBeDefined();
    expect(isNode24Line(pkg.engines?.node ?? "")).toBe(true);
  });

  it(".nvmrc is a Node 24 version and satisfies engines.node", () => {
    expect(nvmrc).toMatch(/^24\.\d+\.\d+$/);
    expect(Number(nvmrc.split(".")[0])).toBe(MAJOR);
  });
});
