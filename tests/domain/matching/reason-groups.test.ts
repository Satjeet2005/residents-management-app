import { describe, expect, it } from "vitest";
import { GROUPS_OF_CODE, REASON_GROUPS, codesOfGroup, reasonGroups } from "@/domain/matching/reason-groups";
import { REASON_CODES } from "@/domain/matching/types";

describe("RG1 every reason code is mapped (D192)", () => {
  it("the table has exactly one entry for each code of the matcher, no more and no fewer", () => {
    expect(Object.keys(GROUPS_OF_CODE).sort()).toEqual([...REASON_CODES].sort());
  });

  it("each entry is a list of known groups without repeats", () => {
    for (const code of REASON_CODES) {
      const groups = GROUPS_OF_CODE[code];
      expect(new Set(groups).size, code).toBe(groups.length);
      for (const group of groups) expect(REASON_GROUPS, code).toContain(group);
    }
  });

  it("a code that maps to no group is a decision, listed here, not an omission", () => {
    const empty = REASON_CODES.filter((code) => GROUPS_OF_CODE[code].length === 0).sort();
    expect(empty).toEqual(["ABOVE_THRESHOLD", "AMOUNT_EQUALS_DUE", "BANK_CHARGE", "CHEQUE_RETURN", "CODE_FOUND", "DEBIT", "INTEREST", "NAME_EXACT", "PAYER_KNOWN"]);
  });

  it("every group has at least one code, so no filter option is empty by construction", () => {
    for (const group of REASON_GROUPS) expect(codesOfGroup(group).length, group).toBeGreaterThan(0);
  });
});

describe("RG2 reasonGroups", () => {
  it.each([
    [["NO_MATCH"], null, ["noflat"]],
    [["NO_NARRATION", "NO_MATCH"], null, ["noflat"]],
    [["CODE_AMBIGUOUS", "PAYER_SHARED"], null, ["several"]],
    [["AMOUNT_LESS"], null, ["differs"]],
    [["NO_OPEN_BILL", "AMOUNT_MORE"], null, ["differs"]],
    [["NEEDS_SECOND_SIGNAL"], null, ["low"]],
    [["CODE_FOUND", "NAME_EXACT", "AMOUNT_EQUALS_DUE"], null, []],
    [["CODE_FOUND"], "LOW", ["low"]],
    [["AMOUNT_LESS", "CODE_CONFLICT", "NAME_INITIAL", "NO_MATCH"], null, ["noflat", "several", "differs", "low"]],
    [[], null, []],
  ])("%j with confidence %j is in %j (a row can have more than one group)", (codes, confidence, expected) => {
    expect(reasonGroups(codes, confidence)).toEqual(expected);
  });

  it("a code the table does not know, or a hostile one, adds no group and never throws", () => {
    expect(reasonGroups(["SOMETHING_NEW", "__proto__", "constructor", "toString"])).toEqual([]);
  });

  it("the SQL's code lists are the same table: a row is in a group exactly when one of its codes is in codesOfGroup", () => {
    for (const group of REASON_GROUPS) {
      for (const code of REASON_CODES) expect(reasonGroups([code]).includes(group), `${code} ${group}`).toBe(codesOfGroup(group).includes(code));
    }
  });
});
