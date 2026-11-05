import { describe, expect, it } from "vitest";
import { buildMatchContext } from "@/domain/matching/context";
import { AMOUNT_SCORES, EVIDENCE_SCORES, gatherEvidence } from "@/domain/matching/evidence";
import { parseNarration } from "@/domain/matching/narration";
import { bill, flat } from "./builders";

const SEPT = bill("sep", 637000n, "2026-09-10");
const TXN = "2026-10-27";

const context = buildMatchContext([
  flat("T12-0408", { residents: ["Swati Joshi", "Anil Joshi"], bills: [SEPT] }),
  flat("T21-1601", { residents: ["Aamir Shaikh"], upi: ["aamir.s@demo"], bills: [bill("o", 1066000n, "2026-10-09", [{ date: "2026-10-12", amountPaise: 500000n }])] }),
  flat("T07-1203", { residents: ["Neeraj Kulkarni"], payerNames: ["Sunita Kulkarni"] }),
  flat("T01-1101", { residents: ["Ravi Menon"], upi: ["family@demo"] }),
  flat("T11-0101", { residents: ["Gita Menon"], upi: ["family@demo"] }),
]);

const gather = (narration: string, creditPaise: bigint) => gatherEvidence(context, { txnDate: TXN, creditPaise }, parseNarration(narration));
const evidenceOf = (narration: string, creditPaise: bigint): Record<string, string[]> =>
  Object.fromEntries(gather(narration, creditPaise).candidates.map((c) => [c.flatCode, c.evidence]));

describe("identity evidence", () => {
  it("CODE: a certain code for a flat in the society", () => {
    const result = gather("UPI/402200118877/T12 408/maint", 646800n);
    expect(result.codes).toEqual(["T12-0408"]);
    expect(result.candidates.map((c) => [c.flatCode, c.evidence])).toEqual([["T12-0408", ["CODE"]]]);
  });

  it("a valid code for a flat that is not in the society gives no candidate", () => {
    const result = gather("UPI/402200118877/T28 1608/maint", 100n);
    expect(result.codes).toEqual(["T28-1608"]);
    expect(result.codeFlats).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it("PAYER: a UPI id that exactly one flat lists", () => {
    const result = gather("UPI/402200118877/aamir.s@demo/rent", 566000n);
    expect(result.payerFlat?.code).toBe("T21-1601");
    expect(result.candidates[0]).toMatchObject({ flatCode: "T21-1601", evidence: ["PAYER"] });
  });

  it("the UPI id is matched without regard to case", () => {
    expect(gather("UPI/402200118877/AAMIR.S@DEMO/x", 1n).payerFlat?.code).toBe("T21-1601");
  });

  it("PAYER_SHARED: an id on more than one flat is not a payer", () => {
    const result = gather("UPI/402200118877/family@demo/x", 1n);
    expect(result.payerFlat).toBeNull();
    expect(result.vpaFlats).toHaveLength(2);
    expect(result.candidates.map((c) => [c.flatCode, c.evidence])).toEqual([["T01-1101", ["PAYER_SHARED"]], ["T11-0101", ["PAYER_SHARED"]]]);
  });

  it("CODE_AMBIGUOUS: a token that fits two flats names neither with certainty", () => {
    const result = gather("UPI/402200118877/T1 1101", 1n);
    expect(result.hasAmbiguousToken).toBe(true);
    expect(result.codes).toEqual([]);
    expect(result.codeFlats).toEqual([]);
    expect(result.candidates.map((c) => [c.flatCode, c.evidence])).toEqual([["T01-1101", ["CODE_AMBIGUOUS"]], ["T11-0101", ["CODE_AMBIGUOUS"]]]);
  });

  it("a code and a UPI id on different flats give two candidates, the code first", () => {
    const result = gather("UPI/402200118877/aamir.s@demo/T12-0408", 1n);
    expect(result.candidates.map((c) => c.flatCode)).toEqual(["T12-0408", "T21-1601"]);
  });

  it("one flat can carry CODE and PAYER together", () => {
    expect(evidenceOf("UPI/402200118877/aamir.s@demo/T21-1601", 1n)["T21-1601"]).toEqual(["CODE", "PAYER"]);
  });
});

describe("name evidence", () => {
  it("EXACT, INITIAL and TRUNCATED against a resident", () => {
    expect(evidenceOf("NEFT-N30112345678-AAMIR SHAIKH-rent", 1n)).toEqual({ "T21-1601": ["NAME_EXACT"] });
    expect(evidenceOf("NEFT-N30112345678-AAMIR S-rent", 1n)).toEqual({ "T21-1601": ["NAME_INITIAL"] });
    expect(evidenceOf("NEFT-N30112345678-AAMIR SHAIK-rent", 1n)).toEqual({ "T21-1601": ["NAME_TRUNCATED"] });
  });

  it("uses a known payer name as well as the residents", () => {
    expect(evidenceOf("NEFT-N30112345678-SUNITA KULKARNI-x", 1n)).toEqual({ "T07-1203": ["NAME_EXACT"] });
  });

  it("keeps only the best name evidence of a flat", () => {
    expect(evidenceOf("NEFT-N30112345678-KULKARNI NEERAJ-x", 1n)["T07-1203"]).toEqual(["NAME_EXACT"]);
  });

  it("needs every word of the name to pair: a first name alone finds no flat", () => {
    expect(evidenceOf("NEFT-N30112345678-AAMIR KHAN-x", 1n)).toEqual({});
    expect(evidenceOf("NEFT-N30112345678-MENON-x", 1n)).toEqual({});
  });

  it("finds flats that share a surname when the first name is only an initial", () => {
    expect(Object.keys(evidenceOf("NEFT-N30112345678-R MENON-x", 1n))).toEqual(["T01-1101"]);
  });

  it("a name on a rail that gives none finds nothing", () => {
    expect(gather("CASH DEP AAMIR SHAIKH", 1n).candidates).toEqual([]);
  });
});

describe("amount-only candidates", () => {
  it("lists flats whose oldest open bill needs this amount when nothing identifies a flat", () => {
    const result = gather("UPI/402200118877/unknown@demo/x", 646800n);
    expect(result.candidates).toEqual([
      { flatCode: "T12-0408", score: 40, evidence: [], amountDuePaise: 646800n, amountRelation: "EQUALS_DUE" },
    ]);
  });

  it("also lists flats whose principal, without the fee, equals the amount", () => {
    const result = gather("UPI/402200118877/unknown@demo/x", 566000n);
    expect(result.candidates).toEqual([
      { flatCode: "T21-1601", score: 25, evidence: [], amountDuePaise: 569800n, amountRelation: "EQUALS_PRINCIPAL" },
    ]);
  });

  it("adds none when a code names a flat", () => {
    expect(gather("UPI/402200118877/T07 1203", 646800n).candidates.map((c) => c.flatCode)).toEqual(["T07-1203"]);
  });

  it("adds none when a UPI id names a flat", () => {
    expect(gather("UPI/402200118877/aamir.s@demo", 646800n).candidates.map((c) => c.flatCode)).toEqual(["T21-1601"]);
  });

  it("adds them beside name candidates when no code or payer names a flat", () => {
    const result = gather("NEFT-N30112345678-AAMIR SHAIKH-x", 646800n);
    // EQUALS_DUE (40) outranks an exact name with the wrong amount (30 + 5).
    expect(result.candidates.map((c) => [c.flatCode, c.score])).toEqual([["T12-0408", 40], ["T21-1601", 35]]);
  });

  it("finds nothing for an amount no flat needs", () => {
    expect(gather("UPI/402200118877/unknown@demo/x", 12345n).candidates).toEqual([]);
  });
});

describe("scores and ranking", () => {
  it("adds the evidence score and the amount score", () => {
    const [top] = gather("UPI/402200118877/T12 408", 646800n).candidates;
    expect(top.score).toBe(EVIDENCE_SCORES.CODE + AMOUNT_SCORES.EQUALS_DUE);
    expect(top.score).toBe(140);
  });

  it("scores a flat with no open bill 20 lower", () => {
    const [top] = gather("UPI/402200118877/T07 1203", 100n).candidates;
    expect(top).toMatchObject({ amountRelation: "NO_OPEN_BILL", amountDuePaise: null, score: 80 });
  });

  it("counts only the strongest name evidence once, beside code evidence", () => {
    const [top] = gather("NEFT-N30112345678-AAMIR SHAIKH-T21 1601", 566000n).candidates;
    expect(top.evidence).toEqual(["CODE", "NAME_EXACT"]);
    expect(top.score).toBe(100 + 30 + 25);
  });

  it("breaks equal scores by flat code", () => {
    const codes = gather("UPI/402200118877/family@demo/x", 1n).candidates.map((c) => c.flatCode);
    expect(codes).toEqual([...codes].sort());
  });

  it("is in descending score order", () => {
    const scores = gather("NEFT-N30112345678-AAMIR SHAIKH-T12 408", 646800n).candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});
