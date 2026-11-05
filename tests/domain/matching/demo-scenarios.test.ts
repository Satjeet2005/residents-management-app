import { beforeAll, describe, expect, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { buildMatchContext } from "@/domain/matching/context";
import { matchRow } from "@/domain/matching/decide";
import { gatherEvidence } from "@/domain/matching/evidence";
import { parseNarration } from "@/domain/matching/narration";
import type { FlatContext, MatchContext, RowDecision } from "@/domain/matching/types";
import { createPrng } from "@/domain/seed/prng";
import { demoDataset, flatContextsFromDataset } from "./context";

const AS_OF = "2026-10-27";
const UNIQUE_UPI = "aamir.shaikh@demo";

let flats: FlatContext[];
let context: MatchContext;

beforeAll(() => {
  // T21-1601 has no known payer in the seed (each scenario starts clean), so the scenario gives it one.
  flats = flatContextsFromDataset(demoDataset()).map((f) => (f.code === "T21-1601" ? { ...f, knownPayers: [{ type: "UPI_ID", value: UNIQUE_UPI }] } : f));
  context = buildMatchContext(flats);
});

const decide = (narration: string, creditPaise: bigint, txnDate = AS_OF): RowDecision =>
  matchRow(context, { txnDate, narrationRaw: narration, creditPaise, debitPaise: 0n }, parseNarration(narration));

/** The flats whose oldest unpaid bill needs `amount` as principal or as principal plus fee, worked out straight from computeLateFee. */
function flatsOwing(amount: bigint, field: "due" | "principal"): string[] {
  return flats
    .filter((f) => {
      for (const bill of f.openBills) {
        const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf: AS_OF, payments: bill.paymentsOnBill, holds: [], policy: defaultLateFeePolicy });
        if (result.outstandingPaise > 0n) return (field === "due" ? result.outstandingPaise + result.feePaise : result.outstandingPaise) === amount;
      }
      return false;
    })
    .map((f) => f.code);
}

describe("X8 demo scenarios as of 2026-10-27", () => {
  it("T12-0408 paying 646800 with 'T12 408' is AUTO with the plan [LATE_FEE 9800, PAYMENT 646800]", () => {
    const d = decide("UPI/402200118877/T12 408/maint", 646800n);
    expect(d).toMatchObject({ kind: "AUTO_MATCH", confidence: "HIGH", flatCode: "T12-0408" });
    expect(d.plan?.entries).toEqual([
      { entryType: "LATE_FEE", amountPaise: 9800n, effectiveDate: AS_OF, billKey: "bill:T12-0408:2026-09-01" },
      { entryType: "PAYMENT", amountPaise: 646800n, effectiveDate: AS_OF, billKey: "bill:T12-0408:2026-09-01" },
    ]);
  });

  it("T21-1601 paying 566000 with its UPI id is QUEUE MEDIUM: 3800 would remain", () => {
    expect(context.flatsByUpiId.get(UNIQUE_UPI)).toHaveLength(1);
    const d = decide(`UPI/402200118877/${UNIQUE_UPI}/maint`, 566000n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: "T21-1601", plan: null });
    expect(d.reasons.map((r) => r.text)).toContain("Amount equals the unpaid bill but not the late fee: ₹38 would remain");
    expect(d.candidates[0]).toMatchObject({ flatCode: "T21-1601", amountDuePaise: 569800n, amountRelation: "EQUALS_PRINCIPAL" });
  });

  it("T21-1601 paying 569800 with its UPI id is AUTO", () => {
    expect(decide(`UPI/402200118877/${UNIQUE_UPI}/maint`, 569800n).kind).toBe("AUTO_MATCH");
  });

  it("1,066,000 (principal only) with no code is QUEUE LOW and lists the flats that owe it, with the total", () => {
    const owing = flatsOwing(1_066_000n, "principal");
    expect(owing).toEqual(expect.arrayContaining(["T03-0702", "T18-1105", "T26-0301"]));
    const narration = "UPI/402200118877/stranger@zzz";
    const d = decide(narration, 1_066_000n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", flatCode: null, plan: null, totalCandidates: owing.length });
    expect(d.candidates).toHaveLength(5);
    expect(d.candidates.every((c) => c.amountRelation === "EQUALS_PRINCIPAL")).toBe(true);
    expect(d.reasons).toContainEqual({ code: "MULTIPLE_FLATS_OWE", text: `${owing.length} flats owe ₹10,660` });
    // The list shows 5; the full ranked list names every flat.
    const all = gatherEvidence(context, { txnDate: AS_OF, creditPaise: 1_066_000n }, parseNarration(narration)).candidates.map((c) => c.flatCode);
    expect(all.sort()).toEqual([...owing].sort());
  });

  it("1,072,000 (principal plus the 17-day fee) is EQUALS_DUE for the same three flats and also QUEUE LOW", () => {
    const owing = flatsOwing(1_072_000n, "due");
    expect(owing).toEqual(expect.arrayContaining(["T03-0702", "T18-1105", "T26-0301"]));
    const narration = "UPI/402200118877/stranger@zzz";
    const d = decide(narration, 1_072_000n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "LOW", totalCandidates: owing.length });
    expect(codesOf(d)).toContain("MULTIPLE_FLATS_OWE");
    const all = gatherEvidence(context, { txnDate: AS_OF, creditPaise: 1_072_000n }, parseNarration(narration)).candidates;
    for (const code of ["T03-0702", "T18-1105", "T26-0301"]) {
      expect(all.find((c) => c.flatCode === code)).toMatchObject({ amountRelation: "EQUALS_DUE", amountDuePaise: 1_072_000n });
    }
  });

  it("T15-0902 paying its oldest bill plus fee is AUTO only with a code", () => {
    expect(decide("UPI/402200118877/T15 902", 871_300n)).toMatchObject({ kind: "AUTO_MATCH", flatCode: "T15-0902" });
    expect(decide("UPI/402200118877/T15 902", 871_300n).plan?.entries.map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 13300n], ["PAYMENT", 871_300n]]);
    for (const narration of ["UPI/402200118877/stranger@zzz", "NEFT-N30112345678-ROHIT DESHMUKH-maint"]) {
      expect(decide(narration, 871_300n).kind).toBe("QUEUE");
    }
  });

  it("T15-0902 paying both bills combined (1,734,100) is never AUTO", () => {
    const d = decide("UPI/402200118877/T15 902", 1_734_100n);
    expect(d).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM", flatCode: "T15-0902" });
    expect(codesOf(d)).toContain("AMOUNT_MORE");
  });
});

const codesOf = (d: RowDecision): string[] => d.reasons.map((r) => r.code);

/** A deterministic mix of 1,000 rows: codes, payers, names, noise, debits, empty narrations. */
function sampleRows(count: number): { narration: string; credit: bigint; debit: bigint; date: string }[] {
  const rng = createPrng(20261105);
  const withBills = flats.filter((f) => f.openBills.length > 0);
  return Array.from({ length: count }, (_, i) => {
    const date = `2026-10-${String(rng.int(1, 27)).padStart(2, "0")}`;
    const f = rng.chance(0.7) ? rng.pick(withBills) : rng.pick(flats);
    const due = BigInt(rng.int(300, 1_800)) * 1000n;
    const credit = f.openBills.length > 0 && rng.chance(0.5) ? f.openBills[0].amountPaise : due;
    const kind = rng.int(0, 9);
    const reference = String(402200000000 + i);
    if (kind <= 2) return { narration: `UPI/${reference}/${f.code.replace("-", " ")}/maint`, credit, debit: 0n, date };
    if (kind === 3) return { narration: `UPI/${reference}/${f.knownPayers[0]?.value ?? "x@demo"}/maint`, credit, debit: 0n, date };
    if (kind <= 5) return { narration: `NEFT-N30${reference}-${(f.residents[0]?.name ?? "NOBODY HERE").toUpperCase()}-maint`, credit, debit: 0n, date };
    if (kind === 6) return { narration: "", credit, debit: 0n, date };
    if (kind === 7) return { narration: "ATM WDL", credit: 0n, debit: credit, date };
    return { narration: `UPI/${reference}/stranger@zzz`, credit, debit: 0n, date };
  });
}

describe("X10 every decision is well formed", () => {
  it("2,000 rows: reasons, plan, confidence, ordering and the 5-candidate cap", () => {
    for (const row of sampleRows(2000)) {
      const d = matchRow(context, { txnDate: row.date, narrationRaw: row.narration, creditPaise: row.credit, debitPaise: row.debit }, parseNarration(row.narration));
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.candidates.length).toBeLessThanOrEqual(5);
      expect(d.totalCandidates).toBeGreaterThanOrEqual(d.candidates.length);
      const scores = d.candidates.map((c) => c.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      if (d.kind === "AUTO_MATCH") {
        expect(d.confidence).toBe("HIGH");
        expect(d.plan).not.toBeNull();
        expect(d.flatCode).toBe(d.candidates[0].flatCode);
        expect(d.candidates[0].evidence.some((e) => e === "CODE" || e === "PAYER")).toBe(true);
        expect(d.plan?.entries.filter((e) => e.entryType === "PAYMENT").map((e) => e.amountPaise)).toEqual([row.credit]);
      } else {
        expect(d.plan).toBeNull();
      }
      if (d.kind === "IGNORE") expect(d.ignoreKind).toBeDefined();
      if (d.kind === "QUEUE" && d.confidence === "MEDIUM") expect(d.candidates.length).toBeGreaterThan(0);
    }
  });
});

describe("X11 speed", () => {
  it("buildMatchContext over the demo dataset takes under 1.5 s", () => {
    const start = performance.now();
    const built = buildMatchContext(flats);
    const elapsed = performance.now() - start;
    expect(built.flats).toHaveLength(2400);
    expect(elapsed).toBeLessThan(1500);
  });

  it("matching 1,000 rows against it takes under 1.5 s", () => {
    const rows = sampleRows(1000);
    const fresh = buildMatchContext(flats);
    const start = performance.now();
    for (const row of rows) matchRow(fresh, { txnDate: row.date, narrationRaw: row.narration, creditPaise: row.credit, debitPaise: row.debit }, parseNarration(row.narration));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1500);
  });
});
