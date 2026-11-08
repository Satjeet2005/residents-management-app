import { describe, expect, it } from "vitest";
import { ageingTable } from "@/domain/reports/age";
import { towerRollup } from "@/domain/reports/towers";
import { createPrng } from "@/domain/seed/prng";
import { type FlatSpec, bill, payment, positionsOf, randomFlat } from "./report-helpers";

const AS_OF = "2026-10-27";
const flat = (code: string, tower: string, ...bills: ReturnType<typeof bill>[]): FlatSpec => ({ flatId: `id-${code}`, flatCode: code, tower, bills, entries: [] });
const oldBill = (period: string, amount: bigint, dueOn: string) => ({ ...bill(period, amount), dueOn });

describe("TW1 what is owed by tower (D182)", () => {
  it("no open bill is no tower and zero totals", () => {
    expect(towerRollup([], AS_OF)).toEqual({ towers: [], total: { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n, flatsOver90: 0 } });
    const b = bill("2026-09-01", 100_000n);
    expect(towerRollup(positionsOf([{ flatId: "a", flatCode: "T01-0001", bills: [b], entries: [payment(b.id, 100_000n, "2026-09-05")] }], AS_OF), AS_OF).towers).toEqual([]);
  });

  it("each tower has its flats, bills, unpaid bills, late fees and flats over 90 days; the most owing first, ties by tower name", () => {
    const positions = positionsOf(
      [
        flat("T12-0101", "T12", oldBill("2026-06-01", 100_000n, "2026-06-10")),
        flat("T12-0102", "T12", oldBill("2026-09-01", 100_000n, "2026-09-10"), oldBill("2026-10-01", 100_000n, "2026-10-10")),
        flat("T03-0101", "T03", oldBill("2026-09-01", 900_000n, "2026-09-10")),
        flat("T07-0101", "T07", oldBill("2026-09-01", 900_000n, "2026-09-10")),
      ],
      AS_OF,
    );
    const { towers, total } = towerRollup(positions, AS_OF);
    expect(towers.map((t) => t.tower)).toEqual(["T03", "T07", "T12"]);
    expect(towers.map((t) => t.amountDuePaise > 0n)).toEqual([true, true, true]);
    const t12 = towers.find((t) => t.tower === "T12");
    expect(t12).toMatchObject({ flats: 2, bills: 3, flatsOver90: 1 });
    expect(towers.find((t) => t.tower === "T03")).toMatchObject({ flats: 1, bills: 1, flatsOver90: 0 });
    expect(total).toMatchObject({ flats: 4, bills: 5, flatsOver90: 1 });
  });

  it("a tie in the amount is ordered by tower name, the same on every read", () => {
    const positions = positionsOf([flat("T07-0101", "T07", oldBill("2026-09-01", 900_000n, "2026-09-10")), flat("T03-0101", "T03", oldBill("2026-09-01", 900_000n, "2026-09-10"))], AS_OF);
    expect(towerRollup(positions, AS_OF).towers.map((t) => t.tower)).toEqual(["T03", "T07"]);
  });

  it("over 90 days means 91 or more: a bill 90 days past due is not, 91 is", () => {
    const at90 = positionsOf([flat("T01-0001", "T01", oldBill("2026-07-01", 100_000n, "2026-07-29"))], AS_OF); // 90 days to 27 Oct
    const at91 = positionsOf([flat("T01-0001", "T01", oldBill("2026-07-01", 100_000n, "2026-07-28"))], AS_OF);
    expect(towerRollup(at90, AS_OF).total.flatsOver90).toBe(0);
    expect(towerRollup(at91, AS_OF).total.flatsOver90).toBe(1);
  });

  it("over 2,000 random sets the towers add up to the age groups' Total owed exactly: flats, bills, unpaid bills, late fees and the amount", () => {
    const r = createPrng(1805);
    for (let n = 0; n < 2000; n++) {
      const flats = Array.from({ length: r.int(1, 8) }, (_, i) => ({ ...randomFlat(r.fork(`t${n}-${i}`), i), tower: `T${String(r.int(1, 4)).padStart(2, "0")}` }));
      const asOf = new Date(Date.UTC(2026, r.int(5, 11), r.int(1, 28))).toISOString().slice(0, 10);
      const positions = positionsOf(flats, asOf);
      const rollup = towerRollup(positions, asOf);
      const ageing = ageingTable(positions, asOf);
      const label = `set ${n}`;
      expect(rollup.total.amountDuePaise, label).toBe(ageing.total.amountDuePaise);
      expect(rollup.total.unpaidBillsPaise, label).toBe(ageing.total.unpaidBillsPaise);
      expect(rollup.total.lateFeesPaise, label).toBe(ageing.total.lateFeesPaise);
      expect(rollup.total.bills, label).toBe(ageing.total.bills);
      expect(rollup.total.flats, label).toBe(ageing.total.flats);
      expect(rollup.towers.reduce((sum, t) => sum + t.amountDuePaise, 0n), label).toBe(ageing.total.amountDuePaise);
      expect(rollup.towers.reduce((sum, t) => sum + t.flats, 0), label).toBe(ageing.total.flats);
      expect(rollup.towers.reduce((sum, t) => sum + t.bills, 0), label).toBe(ageing.total.bills);
      for (const t of rollup.towers) expect(t.unpaidBillsPaise + t.lateFeesPaise, label).toBe(t.amountDuePaise);
    }
  });
});
