import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { parseStatementCsv } from "@/domain/matching/csv";
import { parseNarration } from "@/domain/matching/narration";
import { BEHAVIOUR_WEIGHTS, RAIL_WEIGHTS, STYLE_WEIGHTS, defaultBase, shuffleStatement, simulateOverlappingStatements, simulateStatement } from "@/domain/matching/benchmark/simulate";
import { REGISTERED_SHARE, type Base } from "@/domain/matching/benchmark/population";
import type { FlatContext } from "@/domain/matching/types";

let base: Base;
beforeAll(() => {
  base = defaultBase();
});

const dueOf = (flat: FlatContext, asOf: string): { bill: string; outstanding: bigint; due: bigint }[] =>
  [...flat.openBills]
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))
    .map((b) => ({ b, r: computeLateFee({ billAmountPaise: b.amountPaise, dueOn: b.dueOn, asOf, payments: b.paymentsOnBill.filter((p) => p.date <= asOf), holds: [], policy: defaultLateFeePolicy }) }))
    .filter(({ r }) => r.outstandingPaise > 0n)
    .map(({ b, r }) => ({ bill: b.billKey, outstanding: r.outstandingPaise, due: r.outstandingPaise + r.feePaise }));

describe("the simulator is deterministic and fast", () => {
  it("the same options give the same bytes, and another seed gives another statement", () => {
    const a = simulateStatement({ seed: 7, rows: 300, base });
    const b = simulateStatement({ seed: 7, rows: 300, base });
    expect(b.csvText).toBe(a.csvText);
    expect(b.truth).toEqual(a.truth);
    expect(simulateStatement({ seed: 8, rows: 300, base }).csvText).not.toBe(a.csvText);
  });

  it("2,000 rows take under 1.5 s", () => {
    const start = performance.now();
    simulateStatement({ seed: 1, rows: 2000, base });
    expect(performance.now() - start).toBeLessThan(1500);
  });
});

describe("the statement is a canonical CSV with one truth per row", () => {
  it("reads without errors, and every row has a truth in the same order", () => {
    const sim = simulateStatement({ seed: 3, rows: 2000, base });
    const csv = parseStatementCsv(sim.csvText);
    expect(csv.errors).toEqual([]);
    expect(csv.rows).toHaveLength(2000);
    expect(sim.truth.map((t) => t.rowNumber)).toEqual(csv.rows.map((r) => r.rowNumber));
    for (const r of csv.rows) {
      expect(r.txnDate <= "2026-10-27" && r.txnDate >= "2026-06-01").toBe(true);
      expect((r.creditPaise > 0n) !== (r.debitPaise > 0n)).toBe(true);
      const kind = sim.truth[r.rowNumber - 1].truth.kind;
      if (r.debitPaise > 0n) expect(["NOT_MAINTENANCE", "RETURN"]).toContain(kind);
      else expect(kind).not.toBe("RETURN");
    }
    expect(csv.rows.map((r) => r.txnDate)).toEqual([...csv.rows.map((r) => r.txnDate)].sort());
  });
});

describe("the truth agrees with the amounts, recomputed from computeLateFee", () => {
  it("every kind of bill payment has the amount its truth says, on its date", () => {
    const sim = simulateStatement({ seed: 4, rows: 2000, base });
    const csv = parseStatementCsv(sim.csvText);
    const flats = new Map(sim.flats.map((f) => [f.code, f]));
    const counts: Record<string, number> = {};
    for (const r of csv.rows) {
      const { kind, flatCode, billKeys } = sim.truth[r.rowNumber - 1].truth;
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (flatCode === null) {
        expect(billKeys).toEqual([]);
        continue;
      }
      const flat = flats.get(flatCode) as FlatContext;
      const owed = dueOf(flat, r.txnDate);
      const credit = r.creditPaise;
      if (kind === "PAYS_BILL") {
        expect(credit).toBe(owed[0].due);
        expect(billKeys).toEqual([owed[0].bill]);
      } else if (kind === "MULTI_BILL") {
        expect(billKeys).toEqual([owed[0].bill, owed[1].bill]);
        expect(credit).toBe(owed[0].due + owed[1].due);
      } else if (kind === "ADVANCE") {
        expect(owed.length === 0 || credit > owed[0].due).toBe(true);
      } else if (kind === "PARTIAL") {
        expect(credit > 0n && credit <= owed[0].due && credit !== owed[0].due).toBe(true);
      } else if (kind === "AMBIGUOUS_INTENT") {
        const oldest = flat.openBills.find((b) => b.billKey === billKeys[0]);
        const later = oldest?.paymentsOnBill.some((p) => p.date > r.txnDate) === true;
        expect(later || (credit !== owed[0].due && credit !== owed[0].outstanding)).toBe(true);
      }
    }
    for (const kind of ["PAYS_BILL", "MULTI_BILL", "ADVANCE", "PARTIAL", "NOT_MAINTENANCE", "RETURN", "AMBIGUOUS_INTENT"]) expect(counts[kind]).toBeGreaterThan(0);
  });

  it("a stale-order row is dated before a payment that is on the OLDEST open bill of its flat", () => {
    for (const seed of [11, 12, 13]) {
      const sim = simulateStatement({ seed, rows: 2000, base });
      const csv = parseStatementCsv(sim.csvText);
      const flats = new Map(sim.flats.map((f) => [f.code, f]));
      for (const r of csv.rows) {
        const t = sim.truth[r.rowNumber - 1].truth;
        if (t.kind !== "AMBIGUOUS_INTENT") continue;
        const flat = flats.get(t.flatCode as string) as FlatContext;
        const oldest = dueOf(flat, r.txnDate)[0].bill;
        expect(t.billKeys).toEqual([oldest]);
      }
    }
  });

  it("a flat is the subject of at most one bill payment per statement", () => {
    const sim = simulateStatement({ seed: 5, rows: 2000, base });
    const subjects = sim.truth.filter((t) => ["PAYS_BILL", "PARTIAL", "MULTI_BILL", "AMBIGUOUS_INTENT"].includes(t.truth.kind) && t.truth.billKeys.length > 0).map((t) => t.truth.flatCode);
    expect(new Set(subjects).size).toBe(subjects.length);
  });
});

describe("the mixes follow the documented weights", () => {
  it("over five statements the behaviours, rails and the registered share are close to their weights", () => {
    const statements = [21, 22, 23, 24, 25].map((seed) => simulateStatement({ seed, rows: 2000, base }));
    const rows = statements.flatMap((s) => parseStatementCsv(s.csvText).rows.map((r) => ({ r, truth: s.truth[r.rowNumber - 1].truth })));
    const share = (n: number): number => n / rows.length;
    const total = Object.values(BEHAVIOUR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(98.5, 5);
    expect(share(rows.filter(({ r }) => r.debitPaise > 0n).length)).toBeGreaterThan((BEHAVIOUR_WEIGHTS.DEBIT + BEHAVIOUR_WEIGHTS.CHEQUE_RETURN) / total - 0.03);
    expect(share(rows.filter(({ r }) => r.debitPaise > 0n).length)).toBeLessThan((BEHAVIOUR_WEIGHTS.DEBIT + BEHAVIOUR_WEIGHTS.CHEQUE_RETURN) / total + 0.03);
    const pays = share(rows.filter(({ truth }) => truth.kind === "PAYS_BILL").length);
    expect(pays).toBeGreaterThan(0.12);
    expect(pays).toBeLessThan(0.22);

    const rails = new Map<string, number>();
    for (const { r, truth } of rows) {
      const parsed = parseNarration(r.narrationRaw);
      rails.set(parsed.rail, (rails.get(parsed.rail) ?? 0) + 1);
      // Payments by cheque and cash carry no reference number (the simulator's own "CHQ PAID" debits do).
      const payment = r.creditPaise > 0n && truth.kind !== "NOT_MAINTENANCE";
      if (payment && (parsed.rail === "CHEQUE_DEPOSIT" || parsed.rail === "CASH_DEPOSIT")) expect(parsed.reference).toBeNull();
    }
    for (const rail of ["UPI", "NEFT", "IMPS", "RTGS", "CHEQUE_DEPOSIT", "CASH_DEPOSIT"]) expect(rails.get(rail)).toBeGreaterThan(0);
    expect(Object.values(STYLE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(RAIL_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);

    const population = statements[0].population;
    const registered = population.people.filter((p) => population.flats.find((f) => f.code === p.flatCode)?.knownPayers.some((k) => k.value === p.upi));
    expect(registered.length / population.people.length).toBeGreaterThan(REGISTERED_SHARE - 0.03);
    expect(registered.length / population.people.length).toBeLessThan(REGISTERED_SHARE + 0.03);
    const holders = new Map<string, number>();
    for (const f of population.flats) for (const k of f.knownPayers) holders.set(k.value, (holders.get(k.value) ?? 0) + 1);
    const sharedIds = [...holders.values()].filter((n) => n > 1).length;
    expect(sharedIds / holders.size).toBeGreaterThan(0.01);
    expect(sharedIds / holders.size).toBeLessThan(0.08);
  });
});

describe("overlap and order", () => {
  it("two overlapping statements share their last lines and truth", () => {
    const { first, second } = simulateOverlappingStatements({ seed: 31, rows: 200, overlap: 50, base });
    const a = first.csvText.trimEnd().split("\n").slice(1);
    const b = second.csvText.trimEnd().split("\n").slice(1);
    expect(a).toHaveLength(200);
    expect(b).toHaveLength(200);
    expect(b.slice(150)).toEqual(a.slice(150));
    expect(second.truth.slice(150).map((t) => t.truth)).toEqual(first.truth.slice(150).map((t) => t.truth));
    expect(second.truth.map((t) => t.rowNumber)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(second.flats).toBe(first.flats);
  });

  it("a shuffled statement has the same lines and each truth follows its line", () => {
    const sim = simulateStatement({ seed: 32, rows: 300, base });
    const shuffled = shuffleStatement(sim, 9);
    const lines = (s: typeof sim): string[] => s.csvText.trimEnd().split("\n").slice(1);
    expect([...lines(shuffled)].sort()).toEqual([...lines(sim)].sort());
    expect(lines(shuffled)).not.toEqual(lines(sim));
    const truthOfLine = new Map(lines(sim).map((l, i) => [l, sim.truth[i].truth]));
    lines(shuffled).forEach((l, i) => expect(shuffled.truth[i].truth).toEqual(truthOfLine.get(l)));
  });
});

describe("the benchmark folder is pure", () => {
  const dir = path.resolve(process.cwd(), "src/domain/matching/benchmark");
  it.each(readdirSync(dir).filter((f) => f.endsWith(".ts")))("%s imports only relative paths and uses no clock, randomness, Intl or Node built-ins", (file) => {
    const source = readFileSync(path.join(dir, file), "utf8");
    for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) expect(m[1].startsWith(".")).toBe(true);
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(|\bIntl\b|node:|\bcrypto\b/);
  });
});
