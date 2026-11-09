import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe("VC1 'Choose sections' is retired (a hub of section pages makes hiding unnecessary)", () => {
  const sources = files(path.resolve(process.cwd(), "src")).map((file) => ({ file, text: readFileSync(file, "utf8") }));

  it("no source reads or writes the committee_view cookie, and its module and action are gone", () => {
    expect(sources.filter((s) => /committee_view|VIEW_COOKIE|parseHiddenSections|applySectionChoice|saveSections/.test(s.text)).map((s) => s.file)).toEqual([]);
    expect(existsSync(path.resolve(process.cwd(), "src/server/reports/view-cookie.ts"))).toBe(false);
  });

  it("no source has the sheet, its button or its words", () => {
    expect(existsSync(path.resolve(process.cwd(), "src/app/(staff)/staff/reports/choose-sections.tsx"))).toBe(false);
    expect(sources.filter((s) => s.text.includes("Choose sections")).map((s) => s.file)).toEqual([]);
  });
});
