import { beforeAll, describe, expect, it } from "vitest";
import type { StatementRow } from "@/domain/matching/csv";
import { processStatement } from "@/domain/matching/processor";
import type { FlatContext, OpenBill } from "@/domain/matching/types";
import { createPrng, type Prng } from "@/domain/seed/prng";
import { bill, flat } from "./builders";
import { demoDataset, flatContextsFromDataset } from "./context";
import { dueOf, inputFor, randomRows, row, sampleFlats, samplePools } from "./processor-generators";
import { inputOf } from "./processor-helpers";

let demoFlats: FlatContext[];
let pools: ReturnType<typeof samplePools>;
beforeAll(() => {
  demoFlats = flatContextsFromDataset(demoDataset());
  pools = samplePools(demoFlats);
});

/** The same rows in a random array order, numbered by their new position. */
const reordered = (rng: Prng, rows: readonly StatementRow[]): StatementRow[] => rng.shuffle(rows).map((r, i) => ({ ...r, rowNumber: i + 1 }));
const autoKeys = (flats: FlatContext[], rows: StatementRow[]): string[] =>
  processStatement(inputFor(rows, flats)).rows.filter((r) => r.state === "AUTO_MATCHED").map((r) => r.dedupeKey).sort();

describe("Z1 order of rows: the same automatic matches when no two rows touch a bill", () => {
  /** One row per flat (each pays its own oldest bill by code, on a random day of October), plus unrelated rows. */
  function onePerFlat(rng: Prng): { flats: FlatContext[]; rows: StatementRow[] } {
    const flats = sampleFlats(rng.fork("flats"), pools, 60);
    const rows: StatementRow[] = [];
    flats.forEach((f, i) => {
      const date = `2026-10-${String(rng.int(1, 27)).padStart(2, "0")}`;
      const owed = dueOf(f, date);
      // The resident's name is the second signal (M4j); a unique amount would depend on the order of the rows (C26).
      const name = (f.residents[0]?.name ?? "NO NAME").toUpperCase();
      rows.push(row(rows.length + 1, date, `NEFT-N30${402_200_000 + i}-${name}-${f.code}`, owed === null ? 100_000n : owed.due));
    });
    for (let i = 0; i < 10; i++) rows.push(row(rows.length + 1, "2026-10-12", `CASH DEP SLIP ${i}`, 500_000n));
    return { flats, rows };
  }

  it.each([0, 10, 20, 30])("cases from %i (10 each): any order gives the same set of automatic matches", (first) => {
    let autos = 0;
    for (let k = 0; k < 10; k++) {
      const rng = createPrng(20261108 + first + k);
      const { flats, rows } = onePerFlat(rng);
      const expected = autoKeys(flats, rows);
      autos += expected.length;
      for (let s = 0; s < 3; s++) expect(autoKeys(flats, reordered(rng.fork(`shuffle${s}`), rows))).toEqual(expected);
    }
    expect(autos).toBeGreaterThan(10);
  });
});

describe("Z2 order of rows: safety whatever the order", () => {
  const initial = (): Map<string, OpenBill> => new Map(demoFlats.flatMap((f) => f.openBills.map((b) => [b.billKey, b] as const)));

  it.each([0, 10, 20, 30])("cases from %i (10 each): nothing auto-posted exceeds what was due, or lands before a payment already on the bill", (first) => {
    const bills = initial();
    let entries = 0;
    for (let k = 0; k < 10; k++) {
      const rng = createPrng(777 + first + k);
      const flats = sampleFlats(rng.fork("flats"), pools, 60);
      const rows = randomRows(rng.fork("rows"), flats, 40, { duplicates: true, referenceBase: (first + k) * 100 });
      for (let s = 0; s < 3; s++) {
        const result = processStatement(inputFor(reordered(rng.fork(`shuffle${s}`), rows), flats));
        const paid = new Map<string, { payments: number; principal: bigint; date: string }>();
        for (const e of result.entriesToPost) {
          entries++;
          const b = bills.get(e.billKey) as OpenBill;
          expect(b.paymentsOnBill.every((p) => p.date <= e.effectiveDate)).toBe(true);
          const so = paid.get(e.billKey) ?? { payments: 0, principal: 0n, date: e.effectiveDate };
          if (e.entryType === "PAYMENT") {
            so.payments += 1;
            so.principal += e.amountPaise;
          } else so.principal -= e.amountPaise;
          paid.set(e.billKey, so);
        }
        for (const [billKey, so] of paid) {
          const b = bills.get(billKey) as OpenBill;
          const unpaid = b.amountPaise - b.paymentsOnBill.filter((p) => p.date <= so.date).reduce((sum, p) => sum + p.amountPaise, 0n);
          expect(so.payments).toBe(1);
          expect(so.principal).toBeLessThanOrEqual(unpaid);
        }
        expect(result.accounted).toBe(true);
      }
    }
    expect(entries).toBeGreaterThan(10);
  });

  it("the order of the array alone changes nothing: rows are sorted by date and row number", () => {
    const rng = createPrng(5);
    const flats = sampleFlats(rng.fork("flats"), pools, 60);
    const rows = randomRows(rng.fork("rows"), flats, 40, { duplicates: true });
    const once = processStatement(inputFor(rows, flats));
    for (let s = 0; s < 5; s++) expect(processStatement(inputFor(rng.shuffle(rows), flats))).toEqual(once);
  });
});

describe("Z3 rows on the same day: the row numbers decide the order, and either order is safe", () => {
  // Two bills of one flat. Row A pays the older bill (646800), row B the newer one (640600), both on 2026-10-27.
  const flats = [flat("T12-0408", { bills: [bill("sep", 637000n, "2026-09-10"), bill("oct", 637000n, "2026-10-10")] })];
  const A = "2026-10-27,UPI/402200118871/T12 408/maint,6468,,";
  const B = "2026-10-27,UPI/402200118872/T12 408/maint,6406,,";

  it("A then B posts both; B then A posts only A, and queues B", () => {
    expect(processStatement(inputOf(flats, [A, B])).rows.map((r) => r.state)).toEqual(["AUTO_MATCHED", "AUTO_MATCHED"]);
    const reversed = processStatement(inputOf(flats, [B, A]));
    expect(reversed.rows.map((r) => r.state)).toEqual(["QUEUED", "AUTO_MATCHED"]);
    expect(reversed.entriesToPost.filter((e) => e.entryType === "PAYMENT")).toHaveLength(1);
  });

  it("so the number of automatic matches can differ with the order of same-day rows, and neither order double posts", () => {
    for (const lines of [[A, B], [B, A]]) {
      const result = processStatement(inputOf(flats, lines));
      const perBill = new Map<string, number>();
      for (const e of result.entriesToPost.filter((x) => x.entryType === "PAYMENT")) perBill.set(e.billKey, (perBill.get(e.billKey) ?? 0) + 1);
      expect([...perBill.values()].every((n) => n === 1)).toBe(true);
    }
  });
});
