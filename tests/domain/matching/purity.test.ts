import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(process.cwd(), "src/domain/matching");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts")).sort();

/** What src/domain/matching must not use: Node built-ins, Intl, randomness, the clock. */
const FORBIDDEN: [string, RegExp][] = [
  ["a node: import", /from\s+["']node:|require\(\s*["']node:/],
  ["crypto", /\bcrypto\b/],
  ["Intl", /\bIntl\b/],
  ["Math.random", /Math\.random/],
  ["Date.now", /Date\.now/],
  ["new Date()", /new Date\(\s*\)/],
  ["a package import", /from\s+["'][^."']/],
];

describe("P5 matching purity", () => {
  it("covers the matching modules", () => {
    expect(FILES).toEqual(["amounts.ts", "context.ts", "csv.ts", "dedupe.ts", "evidence.ts", "flat-code.ts", "names.ts", "narration.ts", "types.ts"]);
  });

  it.each(FILES)("%s imports only relative paths and uses no clock, randomness, Intl or Node built-ins", (file) => {
    const source = readFileSync(path.join(DIR, file), "utf8");
    const found = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
    expect(found).toEqual([]);
  });

  it.each(FILES)("%s imports only inside src/domain", (file) => {
    const source = readFileSync(path.join(DIR, file), "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
      expect(path.resolve(DIR, match[1]).startsWith(path.resolve(DIR, ".."))).toBe(true);
    }
  });
});
