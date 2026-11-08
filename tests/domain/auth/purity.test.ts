import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(process.cwd(), "src/domain/auth");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts")).sort();

/** What src/domain/auth must not use: Node built-ins, Intl, randomness, the clock. The caller passes time and bytes in. */
const FORBIDDEN: [string, RegExp][] = [
  ["a node: import", /from\s+["']node:|require\(\s*["']node:/],
  ["Intl", /\bIntl\b/],
  ["Math.random", /Math\.random/],
  ["Date.now", /Date\.now/],
  ["new Date()", /new Date\(\s*\)/],
  ["a package import", /from\s+["'][^."']/],
];

describe("AU7 auth purity", () => {
  it("covers the auth modules", () => {
    expect(FILES).toEqual(["otp.ts", "permissions.ts", "phone.ts", "policy.ts", "role-title.ts", "session.ts"]);
  });

  it.each(FILES)("%s uses no Node built-in, Intl, randomness or clock", (file) => {
    const source = readFileSync(path.join(DIR, file), "utf8");
    const found = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
    expect(found).toEqual([]);
  });

  it.each(FILES)("%s imports only relative paths inside src/domain", (file) => {
    const source = readFileSync(path.join(DIR, file), "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
      expect(path.resolve(DIR, match[1]).startsWith(path.resolve(DIR, ".."))).toBe(true);
    }
  });

  it("the pattern list does catch each forbidden use", () => {
    const samples: Record<string, string> = {
      "a node: import": 'import { randomBytes } from "node:crypto";',
      Intl: "new Intl.NumberFormat()",
      "Math.random": "Math.random()",
      "Date.now": "Date.now()",
      "new Date()": "new Date()",
      "a package import": 'import { z } from "zod";',
    };
    for (const [label, pattern] of FORBIDDEN) expect(pattern.test(samples[label]), label).toBe(true);
  });
});
