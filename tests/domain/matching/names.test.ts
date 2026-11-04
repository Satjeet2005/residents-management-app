import { describe, expect, it } from "vitest";
import { nameMatchStrength, normalizeName } from "@/domain/matching/names";

describe("P4 names: normalising", () => {
  it.each([
    ["Aamir Shaikh", "AAMIR SHAIKH"],
    ["  aamir   shaikh ", "AAMIR SHAIKH"],
    ["R.K. O'Brien", "R K OBRIEN"],
    ["SHARMA, R.", "SHARMA R"],
    ["gupta-and-sons", "GUPTA AND SONS"],
    ["", ""],
    ["!!!", ""],
  ])("turns %j into %j", (text, expected) => {
    expect(normalizeName(text)).toBe(expected);
  });
});

describe("P4 names: strength of a match", () => {
  it.each([
    ["AAMIR SHAIKH", "Aamir Shaikh", "EXACT"],
    ["SHAIKH AAMIR", "Aamir Shaikh", "EXACT"],
    ["MR AAMIR SHAIKH", "Aamir Shaikh", "EXACT"],
    ["Aamir Shaikh", "SMT AAMIR SHAIKH", "EXACT"],
    ["DR RAHUL SHARMA", "Rahul Sharma", "EXACT"],
    ["AAMIR S", "Aamir Shaikh", "INITIAL"],
    ["SHARMA R", "Rahul Sharma", "INITIAL"],
    ["A SHAIKH", "Aamir Shaikh", "INITIAL"],
    ["Aamir Shaikh", "AAMIR S", "INITIAL"],
    ["S N DESHPANDE", "Suresh Narayan Deshpande", "INITIAL"],
    ["RAHUL KULKAR", "Rahul Kulkarni", "TRUNCATED"],
    ["Rahul Kulkarni", "RAHUL KULKAR", "TRUNCATED"],
    ["RAHUL KULK", "Rahul Kulkarni", "TRUNCATED"],
    ["RAHUL KULKAR N", "Rahul Kulkarni Nair", "INITIAL"],
    ["RAHUL KUL", "Rahul Kulkarni", "NONE"],
    ["R S", "Rahul Sharma", "NONE"],
    ["AAMIR", "Aamir Shaikh", "NONE"],
    ["AAMIR SHAIKH KHAN", "Aamir Shaikh", "NONE"],
    ["AAMIR PATEL", "Aamir Shaikh", "NONE"],
    ["RAHUL SHARMA", "Rohit Sharma", "NONE"],
    ["SHARMA", "Sharman", "TRUNCATED"],
    ["SHA", "Sharma", "NONE"],
    ["", "Aamir Shaikh", "NONE"],
    ["Aamir Shaikh", "", "NONE"],
    ["MR", "MRS", "NONE"],
    ["A B C D E F G", "A B C D E F G", "NONE"],
  ])("%j against %j is %s", (remitter, resident, expected) => {
    expect(nameMatchStrength(remitter, resident)).toBe(expected);
  });

  it("is the same whichever side is the bank's", () => {
    for (const [a, b] of [["AAMIR S", "Aamir Shaikh"], ["RAHUL KULKAR", "Rahul Kulkarni"], ["SHAIKH AAMIR", "Aamir Shaikh"]]) {
      expect(nameMatchStrength(a, b)).toBe(nameMatchStrength(b, a));
    }
  });
});
