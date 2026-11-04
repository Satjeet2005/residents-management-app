import { describe, expect, it } from "vitest";
import { parseStatementCsv } from "@/domain/matching/csv";
import { extractFlatTokens, isValidFlatCode } from "@/domain/matching/flat-code";
import { parseNarration } from "@/domain/matching/narration";
import { createPrng } from "@/domain/seed/prng";

const RAILS = ["UPI", "NEFT", "IMPS", "RTGS", "CHEQUE_DEPOSIT", "CHEQUE_RETURN", "CASH_DEPOSIT", "BANK_CHARGE", "INTEREST", "UNKNOWN"];

describe("P2 flat codes: property test over random valid codes", () => {
  it("2,000 random codes, with random separators, case and surroundings, give exactly that code", () => {
    const rng = createPrng(20261104);
    const separators = ["", " ", "-", "/", "_", "."];
    const before = ["", "FLAT ", "maint ", "UPI/402200118877/", "(", "NEFT-N30112345-SHARMA R-"];
    const after = ["", " maint", "/x", ")", " 3 months", "-ADV"];
    for (let i = 0; i < 2000; i++) {
      const tower = rng.int(1, 28);
      const floor = rng.int(1, 16);
      const unit = rng.int(1, 8);
      const code = `T${String(tower).padStart(2, "0")}-${String(floor).padStart(2, "0")}${String(unit).padStart(2, "0")}`;
      const prefix = rng.chance(0.5) ? "T" : "t";
      const text = `${rng.pick(before)}${prefix}${rng.pick(separators)}${String(tower).padStart(2, "0")}${rng.pick(separators)}${String(floor).padStart(2, "0")}${String(unit).padStart(2, "0")}${rng.pick(after)}`;
      const tokens = extractFlatTokens(text);
      expect(tokens.map((t) => [t.code, t.ambiguous]), text).toEqual([[code, false]]);
    }
  });

  it("random digit strings without a T never give a flat code", () => {
    const rng = createPrng(7);
    for (let i = 0; i < 2000; i++) {
      const text = Array.from({ length: rng.int(1, 14) }, () => String(rng.int(0, 9))).join(rng.pick(["", " ", "-", "/"]));
      expect(extractFlatTokens(text), text).toEqual([]);
    }
  });
});

describe("P3 narration: fuzz", () => {
  const PIECES = [
    "UPI", "NEFT", "IMPS", "RTGS", "CHQ", "DEP", "RET", "CASH", "INT.PD", "SMS CHARGES", "T12", "T07-1203", "t21 1601", "408", "0408", "402200118877", "N30112345", "HDFCR52026102712345",
    "aamir.s@oksbi", "@", "@@", "AAMIR SHAIKH", "maint", "advance", "3 months", "12 months", "99 mths", "/", "-", "_", "*", " ", "  ", "\t", "\n", "\u0000", "\u0007", "\u001f", "\u007f",
    "😀", "👨‍👩‍👧", "‮", "\ud83d", "é", "देखभाल", "ß", "İ", "\\", "(", ")", "'", '"', ",", ";", ".", "0", "9", "000000000000", "T", "t", "Tt1",
  ];

  it("2,000 random strings: never throws, never changes the text, and returns only well-formed fields", () => {
    const rng = createPrng(424242);
    for (let i = 0; i < 2000; i++) {
      const raw = Array.from({ length: rng.int(0, 40) }, () => rng.pick(PIECES)).join(rng.pick(["", " ", "/", "-"]));
      const copy = `${raw}`;
      const parsed = parseNarration(raw);
      expect(raw).toBe(copy);
      expect(RAILS).toContain(parsed.rail);
      expect(parsed.reference === null || parsed.reference.length > 0).toBe(true);
      expect(parsed.flatTokens.every((t) => isValidFlatCode(t.code))).toBe(true);
      expect(parsed.months === null || (parsed.months >= 1 && parsed.months <= 24)).toBe(true);
      expect(parsed.remitterName === null || parsed.remitterName.length > 0).toBe(true);
      if (parsed.rail === "UNKNOWN") expect([parsed.reference, parsed.remitterName, parsed.notes]).toEqual([null, null, ""]);
    }
  });

  it.each([
    ["an empty string", ""],
    ["5,000 characters", "UPI/402200118877/AAMIR SHAIKH/T21 1601 ".repeat(150)],
    ["5,000 emoji", "😀".repeat(5000)],
    ["5,000 slashes", "/".repeat(5000)],
    ["5,000 letters and no separator", "A".repeat(5000)],
    ["5,000 at-signs and dots", "a.@".repeat(1700)],
    ["5,000 digits", "1".repeat(5000)],
    ["control characters", "\u0000\u0001\u0002UPI\u0003\u0004"],
  ])("handles %s without throwing", (_label, raw) => {
    const started = performance.now();
    expect(() => parseNarration(raw)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("P1 statement CSV: size", () => {
  it("parses a 10,000-row file in under 1.5 seconds", () => {
    const lines = ["Txn Date,Value Date,Narration,Credit,Debit,Balance,Ref"];
    for (let i = 0; i < 10_000; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      lines.push(`${day}/10/2026,${day}-Oct-2026,"UPI/${String(400000000000 + i)}/AAMIR SHAIKH, T21 1601/maint",${(i % 90) + 10}.50,,${100000 + i},REF${i}`);
    }
    const text = lines.join("\r\n");
    const started = performance.now();
    const result = parseStatementCsv(text);
    const elapsed = performance.now() - started;
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(10_000);
    expect(result.rows[9999].rowNumber).toBe(10_000);
    expect(elapsed).toBeLessThan(1500);
  });
});
