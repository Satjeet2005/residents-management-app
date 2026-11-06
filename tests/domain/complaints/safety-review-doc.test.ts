import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAFETY_RULES } from "@/domain/complaints/safety";

/** The review list for a native speaker must list EVERY non-English rule and every one of its words, and say plainly that it is not verified. */
const doc = readFileSync("docs/safety-words-review.md", "utf8");
const rows = doc.split("\n").filter((line) => line.startsWith("| `"));

describe("the safety words review list", () => {
  it("says it is not verified by a native speaker, and has a column for who reviewed it and when, left empty", () => {
    expect(doc).toContain("NOT yet verified by a native speaker");
    expect(doc).toContain("Reviewed by / date");
    for (const row of rows) expect(row.endsWith("| |"), row).toBe(true);
  });

  it("lists every non-English rule, and every word of it, once", () => {
    const nonEnglish = SAFETY_RULES.filter((r) => r.language !== "en");
    expect(nonEnglish.length).toBeGreaterThanOrEqual(50);
    for (const rule of nonEnglish) {
      for (const term of rule.terms) expect(rows.some((row) => row.startsWith(`| \`${rule.id}\` |`) && row.includes(`| ${term} |`)), `${rule.id}: ${term}`).toBe(true);
    }
    expect(rows.length).toBe(nonEnglish.reduce((sum, r) => sum + r.terms.length, 0));
  });

  it("lists no English rule (those are read in the code)", () => {
    for (const rule of SAFETY_RULES.filter((r) => r.language === "en")) expect(doc).not.toContain(`\`${rule.id}\``);
  });
});
