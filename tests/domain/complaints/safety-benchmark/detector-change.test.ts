import { describe, expect, it } from "vitest";
import { SAFETY_RULES, detectSafetyWords, type SafetyHit } from "@/domain/complaints/safety";
import { compileTerms, foldForMatching } from "@/domain/complaints/match";
import { normalizeComplaintText } from "@/domain/complaints/text";
import { generateSeed } from "@/domain/complaints/safety-benchmark/sets";
import { readExpected, seedTally } from "./fixtures";

const LETTER_OR_MARK_OR_DIGIT = /[\p{L}\p{M}\p{N}]/u;
type Rule = (typeof SAFETY_RULES)[number];

/** A test double of the detector that reads a COPY of the rule table (the real rules are never changed): the same loop, with the rules given. */
function detectorOf(rules: readonly Rule[]) {
  const compiled = rules.map((r) => ({ r, pattern: compileTerms(r.terms, r.kind) }));
  return (raw: string): SafetyHit[] => {
    const text = foldForMatching(normalizeComplaintText(raw));
    const hits: SafetyHit[] = [];
    for (const { r, pattern } of compiled) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (r.except !== undefined) {
          let end = start + match[0].length;
          while (end < text.length && LETTER_OR_MARK_OR_DIGIT.test(text[end])) end += 1;
          if (r.except.test(text.slice(start, end))) continue;
        }
        hits.push({ rule: r.id, category: r.category, language: r.language, matched: match[0] });
        break;
      }
    }
    return hits;
  };
}

describe("SB4 a change to the detector shows up in the committed metrics", () => {
  const seed = 301;
  const committed = readExpected("dev").tallies[seed];
  const g = generateSeed(seed);

  it("the test double with an unchanged copy of the rules agrees with the real detector on this seed", () => {
    const double = detectorOf(SAFETY_RULES);
    for (const item of g.single) expect(double(item.text)).toEqual(detectSafetyWords(item.text));
  });

  it("dropping one term of one rule in the copy changes the tally, so the committed-metrics test would fail", () => {
    const changed = SAFETY_RULES.map((r) => (r.id === "FIRE_EN_WORD" ? { ...r, terms: r.terms.filter((t) => t !== "fire") } : r));
    const tally = seedTally(g, detectorOf(changed));
    expect(JSON.parse(JSON.stringify(tally))).not.toEqual(committed);
    expect(tally.overall.single.k).toBeLessThan(committed.overall.single.k);
  });
});
