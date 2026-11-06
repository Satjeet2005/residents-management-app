import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type BillPositionInput, billPosition } from "@/domain/billing/position";
import { type PlannedEntry, planPosting } from "@/domain/billing/posting";
import { addDays } from "@/domain/time/calendar";
import { base, int, randomInput, seededRandom, t21 } from "./position-helpers";

const AS_OF = "2026-10-27";
const plan = (input: BillPositionInput, creditPaise: bigint) => planPosting({ position: billPosition(input), creditPaise, paymentDate: input.asOf });
const entries = (result: ReturnType<typeof plan>): PlannedEntry[] => ("entries" in result ? result.entries : []);
const shape = (result: ReturnType<typeof plan>) => entries(result).map((e) => `${e.entryType} ${e.direction} ${e.amountPaise}`);

describe("PP1 planPosting: a bill with principal open", () => {
  // T21-1601 on 27 Oct: principal ₹5,660, fee ₹38, due ₹5,698.
  it.each<[string, bigint, string[]]>([
    ["credit equals principal plus fee: LATE_FEE, then PAYMENT of the credit", 569_800n, ["LATE_FEE CHARGE 3800", "PAYMENT PAYMENT 569800"]],
    ["credit equals the principal: the fee stays owing", 566_000n, ["LATE_FEE CHARGE 3800", "PAYMENT PAYMENT 566000"]],
    ["credit between the principal and the amount due: the fee is part paid", 567_000n, ["LATE_FEE CHARGE 3800", "PAYMENT PAYMENT 567000"]],
    ["credit below the principal: payment alone, the fee keeps accruing", 100_000n, ["PAYMENT PAYMENT 100000"]],
    ["the smallest credit is one paisa, payment alone", 1n, ["PAYMENT PAYMENT 1"]],
  ])("T21-1601, %s", (_name, credit, expected) => {
    expect(shape(plan(t21(), credit))).toEqual(expected);
  });

  it("every entry is dated the payment date", () => {
    for (const e of entries(plan(t21(), 569_800n))) expect(e.effectiveDate).toBe(AS_OF);
  });

  it("a credit above the amount due is refused as EXCESS", () => {
    expect(plan(t21(), 569_801n)).toEqual({ refused: "EXCESS" });
  });

  it("T12-0408 paid in full on 27 Oct: LATE_FEE ₹98 and PAYMENT ₹6,468", () => {
    expect(shape(plan(base(), 646_800n))).toEqual(["LATE_FEE CHARGE 9800", "PAYMENT PAYMENT 646800"]);
  });

  it("a bill not yet due posts a PAYMENT only, with no zero LATE_FEE", () => {
    expect(shape(plan(base({ dueOn: "2026-11-10" }), 637_000n))).toEqual(["PAYMENT PAYMENT 637000"]);
  });
});

describe("PP2 planPosting: only the fee is left", () => {
  const feeOnly = (): BillPositionInput =>
    t21({ payments: [{ date: "2026-10-12", amountPaise: 500_000n }, { date: AS_OF, amountPaise: 566_000n }], postedFees: [{ date: AS_OF, amountPaise: 3_800n }], asOf: "2026-10-28" });

  it("a part or full payment of the remainder is a PAYMENT alone, never a second LATE_FEE", () => {
    expect(shape(plan(feeOnly(), 3_800n))).toEqual(["PAYMENT PAYMENT 3800"]);
    expect(shape(plan(feeOnly(), 1_800n))).toEqual(["PAYMENT PAYMENT 1800"]);
  });

  it("a credit above the remainder is EXCESS", () => {
    expect(plan(feeOnly(), 3_801n)).toEqual({ refused: "EXCESS" });
  });
});

describe("PP3 planPosting: refusals and errors", () => {
  const settled = (): BillPositionInput => base({ payments: [{ date: "2026-09-05", amountPaise: 637_000n }] });

  it("a settled bill is NO_DUES", () => {
    expect(plan(settled(), 100n)).toEqual({ refused: "NO_DUES" });
  });

  it("a credit of zero or less throws RangeError", () => {
    expect(() => plan(t21(), 0n)).toThrow(RangeError);
    expect(() => plan(t21(), -5n)).toThrow(RangeError);
  });

  it("a position of another date than the payment date throws RangeError", () => {
    expect(() => planPosting({ position: billPosition(t21()), creditPaise: 100n, paymentDate: "2026-10-28" })).toThrow(RangeError);
  });
});

describe("PP4 planPosting: properties over 2,000 seeded random cases", () => {
  const apply = (input: BillPositionInput, planned: readonly PlannedEntry[]): BillPositionInput => ({
    ...input,
    payments: [...input.payments, ...planned.filter((e) => e.entryType === "PAYMENT").map((e) => ({ date: e.effectiveDate, amountPaise: e.amountPaise }))],
    postedFees: [...input.postedFees, ...planned.filter((e) => e.entryType === "LATE_FEE").map((e) => ({ date: e.effectiveDate, amountPaise: e.amountPaise }))],
  });
  const r = seededRandom(20261108);
  const cases = Array.from({ length: 2000 }, () => {
    const input = randomInput(r);
    // Feed the bill the way the system would: a fee posted when the principal was paid.
    const first = billPosition(input);
    const fees = first.kind === "PRINCIPAL_OPEN" || first.settledOn === null ? [] : [{ date: first.settledOn, amountPaise: billPosition({ ...input, asOf: first.settledOn }).feeComputedPaise }].filter((f) => f.amountPaise > 0n);
    return { ...input, postedFees: fees };
  });

  it("applying the entries and recomputing leaves exactly the amount due minus the credit", () => {
    const s = seededRandom(5);
    let planned = 0;
    for (const input of cases) {
      const before = billPosition(input);
      if (before.kind === "SETTLED") continue;
      const credit = 1n + BigInt(int(s, Number(before.amountDuePaise)));
      const result = planPosting({ position: before, creditPaise: credit, paymentDate: input.asOf });
      expect("entries" in result).toBe(true);
      const after = billPosition(apply(input, entries(result)));
      expect(after.amountDuePaise).toBe(before.amountDuePaise - credit);
      expect(after.amountDuePaise >= 0n).toBe(true);
      expect(entries(result).filter((e) => e.entryType === "PAYMENT")).toHaveLength(1);
      expect(entries(result).filter((e) => e.entryType === "LATE_FEE").length).toBeLessThanOrEqual(1);
      planned++;
    }
    expect(planned).toBeGreaterThan(500);
  });

  it("paying exactly the amount due settles the bill, and a settled bill is never reopened by the plan", () => {
    for (const input of cases) {
      const before = billPosition(input);
      if (before.kind === "SETTLED") continue;
      const result = planPosting({ position: before, creditPaise: before.amountDuePaise, paymentDate: input.asOf });
      const after = billPosition(apply(input, entries(result)));
      expect(after.kind).toBe("SETTLED");
      expect(after.anomalies).toEqual([]);
      expect(billPosition({ ...apply(input, entries(result)), asOf: addDays(input.asOf, 30) }).kind).toBe("SETTLED");
    }
  });

  it("a LATE_FEE is planned only when the credit brings the payments to the bill, and only once per bill", () => {
    const s = seededRandom(9);
    for (const input of cases) {
      const before = billPosition(input);
      if (before.kind !== "PRINCIPAL_OPEN") continue;
      const credit = 1n + BigInt(int(s, Number(before.amountDuePaise)));
      const planned = entries(planPosting({ position: before, creditPaise: credit, paymentDate: input.asOf }));
      const hasFee = planned.some((e) => e.entryType === "LATE_FEE");
      expect(hasFee).toBe(credit >= before.principalOutstandingPaise && before.feeComputedPaise > 0n);
      if (hasFee) expect(billPosition(apply(input, planned)).kind === "PRINCIPAL_OPEN").toBe(false);
    }
  });

  it("any credit above the amount due is EXCESS and posts nothing", () => {
    for (const input of cases.slice(0, 500)) {
      const before = billPosition(input);
      if (before.kind === "SETTLED") continue;
      expect(planPosting({ position: before, creditPaise: before.amountDuePaise + 1n, paymentDate: input.asOf })).toEqual({ refused: "EXCESS" });
    }
  });
});

describe("PP5 planPosting: the domain rules", () => {
  it("is fast: 2,000 plans in well under a second", () => {
    const r = seededRandom(4);
    const positions = Array.from({ length: 2000 }, () => {
      const input = randomInput(r);
      return { position: billPosition(input), asOf: input.asOf };
    }).filter((p) => p.position.kind !== "SETTLED");
    const start = performance.now();
    for (const p of positions) planPosting({ position: p.position, creditPaise: p.position.amountDuePaise, paymentDate: p.asOf });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("posting.ts imports only inside src/domain and uses no Intl, node: modules, Math.random or Date.now", () => {
    const source = readFileSync("src/domain/billing/posting.ts", "utf8");
    for (const match of source.matchAll(/from "([^"]+)"/g)) expect(match[1].startsWith(".")).toBe(true);
    expect(source).not.toMatch(/Intl\.|node:|Math\.random|Date\.now/);
  });
});
