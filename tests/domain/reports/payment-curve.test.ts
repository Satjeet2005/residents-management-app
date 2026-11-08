import { describe, expect, it } from "vitest";
import { collectionQuality, moneyLine } from "@/domain/reports/money-line";
import { CURVE_DAYS, paymentCurve } from "@/domain/reports/payment-curve";
import { createPrng } from "@/domain/seed/prng";
import { addDays } from "@/domain/time/calendar";
import { type FlatSpec, bill, lateFee, payment, positionsOf, randomFlat } from "./report-helpers";

const ISSUE = "2026-10-01";
const DUE = "2026-10-10";
const flat = (code: string, bills: ReturnType<typeof bill>[], entries: ReturnType<typeof payment>[] = []): FlatSpec => ({ flatId: `id-${code}`, flatCode: code, bills, entries });
const curveOf = (flats: FlatSpec[], asOf: string) => {
  const positions = positionsOf(flats, asOf);
  return { positions, curve: paymentCurve({ bills: positions.map((p) => ({ amountPaise: p.bill.amountPaise, payments: p.payments })), issueDate: ISSUE, dueDate: DUE, asOf }) };
};

describe("PC1 the payment curve", () => {
  const a = bill(ISSUE, 1_000_000n);
  const b = bill(ISSUE, 1_000_000n);
  const flats = [flat("T01-0001", [a], [payment(a.id, 1_000_000n, "2026-10-03")]), flat("T01-0002", [b], [payment(b.id, 400_000n, "2026-10-10"), payment(b.id, 600_000n, "2026-10-22")])];

  it("counts the money collected by each day since issue: day 0 is the issue date and day 2 is the 3rd", () => {
    const { curve } = curveOf(flats, "2026-10-27");
    expect(curve?.points[0]).toMatchObject({ day: 0, collectedPaise: 0n, percent: 0 });
    expect(curve?.points[1].percent).toBe(0);
    expect(curve?.points[2]).toMatchObject({ collectedPaise: 1_000_000n, percent: 50 });
  });

  it("the due day is day 9 (the 10th), and by that day 70% was collected: 100% of one bill and 40% of the other", () => {
    const { curve } = curveOf(flats, "2026-10-27");
    expect(curve?.dueDay).toBe(9);
    expect(curve?.points[9].percent).toBe(70);
    expect(curve?.byDueDay).toBe(70);
  });

  it("the plain numbers: by the due day, by day 20 and now", () => {
    const { curve } = curveOf(flats, "2026-10-27");
    expect(curve?.byDay20).toBe(70);
    expect(curve?.now).toBe(100);
    expect(curve?.points.at(-1)).toMatchObject({ day: 26, percent: 100 });
  });

  it("stops at the as-of day, omits day 20 before it and the due day until it has come", () => {
    const early = curveOf(flats, "2026-10-05").curve;
    expect(early?.points.at(-1)?.day).toBe(4);
    expect(early?.byDay20).toBeNull();
    expect(early?.byDueDay).toBeNull();
    expect(early?.now).toBe(50);
  });

  it("stops at day 45 for an old month and still reports now", () => {
    const old = curveOf(flats, "2026-12-30").curve;
    expect(old?.points.at(-1)?.day).toBe(CURVE_DAYS);
    expect(old?.points).toHaveLength(CURVE_DAYS + 1);
  });

  it("a payment above the bill (a late fee) does not count, and a payment before the issue date counts on day 0", () => {
    const c = bill(ISSUE, 500_000n);
    const { curve } = curveOf([flat("T01-0003", [c], [payment(c.id, 520_000n, "2026-09-28"), lateFee(c.id, 20_000n, "2026-09-28")])], "2026-10-27");
    expect(curve?.points[0]).toMatchObject({ collectedPaise: 500_000n, percent: 100 });
  });

  it("nothing billed, or as-of before the issue, gives no curve", () => {
    expect(paymentCurve({ bills: [], issueDate: ISSUE, dueDate: DUE, asOf: "2026-10-27" })).toBeNull();
    expect(curveOf(flats, "2026-10-27").curve).not.toBeNull();
    expect(paymentCurve({ bills: [{ amountPaise: 1n, payments: [] }], issueDate: ISSUE, dueDate: DUE, asOf: "2026-09-30" })).toBeNull();
  });

  it("PC2 the relationship to the Paid on time card: equal for equal bills paid in whole; the curve is never below the on-time money share", () => {
    const { positions, curve } = curveOf(flats, "2026-10-27");
    const q = collectionQuality(positions, "2026-10-27");
    expect(q.dueOnTime).toBe(1);
    expect(q.due).toBe(2);
    expect(curve?.byDueDay).toBe(70);
    const whole = curveOf([flat("T01-0004", [a], [payment(a.id, 1_000_000n, "2026-10-03")]), flat("T01-0005", [b])], "2026-10-27");
    const wq = collectionQuality(whole.positions, "2026-10-27");
    expect(whole.curve?.byDueDay).toBe(Math.round((100 * wq.dueOnTime) / wq.due));
  });

  it("PC3 properties over 2,000 seeded inputs: now equals the money line, the curve never falls, and byDueDay is at least the on-time money share", () => {
    const r = createPrng(20261028);
    for (let n = 0; n < 2000; n++) {
      const flats = Array.from({ length: r.int(1, 6) }, (_, i) => randomFlat(r.fork(`c${n}-${i}`), i));
      const asOf = addDays("2026-05-01", r.int(0, 200));
      const positions = positionsOf(flats, asOf).filter((p) => p.bill.period === flats[0].bills[0].period);
      const first = flats[0].bills[0];
      const curve = paymentCurve({ bills: positions.map((p) => ({ amountPaise: p.bill.amountPaise, payments: p.payments })), issueDate: first.issuedOn, dueDate: first.dueOn, asOf });
      if (curve === null) continue;
      const line = moneyLine(positions);
      expect(curve.now, `n=${n}`).toBe(Number((200n * line.collectedPaise + line.billedPaise) / (2n * line.billedPaise)));
      curve.points.forEach((p, i) => i > 0 && expect(p.collectedPaise >= curve.points[i - 1].collectedPaise, `n=${n} day ${i}`).toBe(true));
      if (curve.byDueDay !== null) {
        const onTimeMoney = positions.filter((p) => p.position.settledOn !== null && p.position.settledOn <= p.bill.dueOn).reduce((sum, p) => sum + p.bill.amountPaise, 0n);
        const floor = Number((200n * onTimeMoney + line.billedPaise) / (2n * line.billedPaise));
        expect(curve.byDueDay, `n=${n}`).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});
