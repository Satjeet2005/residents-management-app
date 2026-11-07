import { describe, expect, it } from "vitest";
import { collectionQuality, moneyLine } from "@/domain/reports/money-line";
import { createPrng } from "@/domain/seed/prng";
import { type FlatSpec, bill, lateFee, payment, positionsOf, randomFlat } from "./report-helpers";

const flat = (code: string, bills: ReturnType<typeof bill>[], entries: ReturnType<typeof payment>[] = []): FlatSpec => ({ flatId: `id-${code}`, flatCode: code, bills, entries });
const AS_OF = "2026-10-27";

describe("RP1 the money line", () => {
  it("no bills: everything is zero", () => {
    expect(moneyLine([])).toEqual({ billedPaise: 0n, collectedPaise: 0n, outstandingPaise: 0n, flatsBilled: 0, flatsPaidInFull: 0, flatsOutstanding: 0, fees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n } });
  });

  it("one unpaid bill: all of it is outstanding, its computed fee is accruing, and the flat is not paid in full", () => {
    const [p] = positionsOf([flat("T01-0001", [bill("2026-10-01", 637_000n, "2026-10-10")])], AS_OF);
    const line = moneyLine([p]);
    expect(line).toMatchObject({ billedPaise: 637_000n, collectedPaise: 0n, outstandingPaise: 637_000n, flatsBilled: 1, flatsPaidInFull: 0, flatsOutstanding: 1 });
    expect(line.fees.accruingPaise).toBe(p.position.feeOutstandingPaise);
    expect(line.fees.accruingPaise).toBeGreaterThan(0n);
  });

  it("one bill paid in full on time: Collected is the bill, Outstanding zero, no fee anywhere", () => {
    const b = bill("2026-10-01", 637_000n, "2026-10-10");
    const line = moneyLine(positionsOf([flat("T01-0001", [b], [payment(b.id, 637_000n, "2026-10-08")])], AS_OF));
    expect(line).toMatchObject({ billedPaise: 637_000n, collectedPaise: 637_000n, outstandingPaise: 0n, flatsPaidInFull: 1, flatsOutstanding: 0 });
    expect(line.fees).toEqual({ postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n });
  });

  it("a bill settled LATE with its fee paid: the bill is Collected and the fee is 'posted and paid', not Collected", () => {
    const b = bill("2026-10-01", 637_000n, "2026-10-10");
    const line = moneyLine(positionsOf([flat("T01-0001", [b], [lateFee(b.id, 3_800n, "2026-10-20"), payment(b.id, 640_800n, "2026-10-20")])], AS_OF));
    expect(line.collectedPaise).toBe(637_000n);
    expect(line.fees).toEqual({ postedPaidPaise: 3_800n, postedOwingPaise: 0n, accruingPaise: 0n });
    expect(line.flatsPaidInFull).toBe(1);
  });

  it("a FEE_ONLY bill (principal paid, fee owed): Collected is the bill, the flat is paid in full, and the fee is 'posted and owing'", () => {
    const b = bill("2026-10-01", 637_000n, "2026-10-10");
    const line = moneyLine(positionsOf([flat("T01-0001", [b], [lateFee(b.id, 3_800n, "2026-10-20"), payment(b.id, 637_000n, "2026-10-20")])], AS_OF));
    expect(line).toMatchObject({ collectedPaise: 637_000n, outstandingPaise: 0n, flatsPaidInFull: 1, flatsOutstanding: 0 });
    expect(line.fees).toEqual({ postedPaidPaise: 0n, postedOwingPaise: 3_800n, accruingPaise: 0n });
  });

  it("part payments are counted once: T21-1601 owes 10,660 and paid 5,000 in one part", () => {
    const b = bill("2026-10-01", 1_066_000n, "2026-10-09");
    const line = moneyLine(positionsOf([flat("T21-1601", [b], [payment(b.id, 500_000n, "2026-10-12")])], AS_OF));
    expect(line).toMatchObject({ billedPaise: 1_066_000n, collectedPaise: 500_000n, outstandingPaise: 566_000n, flatsBilled: 1, flatsPaidInFull: 0, flatsOutstanding: 1 });
  });

  it("a bill with two payments is one bill: its two payments add up in Collected and the flat counts once", () => {
    const b = bill("2026-10-01", 1_000_000n, "2026-10-10");
    const line = moneyLine(positionsOf([flat("T01-0001", [b], [payment(b.id, 400_000n, "2026-10-05"), payment(b.id, 600_000n, "2026-10-08")])], AS_OF));
    expect(line).toMatchObject({ billedPaise: 1_000_000n, collectedPaise: 1_000_000n, outstandingPaise: 0n, flatsBilled: 1, flatsPaidInFull: 1 });
  });

  it("a payment above the bill is not Collected: Collected never exceeds Billed", () => {
    const b = bill("2026-10-01", 100_000n, "2026-10-10");
    const line = moneyLine(positionsOf([flat("T01-0001", [b], [payment(b.id, 130_000n, "2026-10-08")])], AS_OF));
    expect(line.collectedPaise).toBe(100_000n);
    expect(line.collectedPaise <= line.billedPaise).toBe(true);
  });

  it("two flats: the amounts and the counts add up", () => {
    const a = bill("2026-10-01", 600_000n);
    const c = bill("2026-10-01", 400_000n);
    const line = moneyLine(positionsOf([flat("T01-0001", [a], [payment(a.id, 600_000n, "2026-10-05")]), flat("T01-0002", [c])], AS_OF));
    expect(line).toMatchObject({ billedPaise: 1_000_000n, collectedPaise: 600_000n, outstandingPaise: 400_000n, flatsBilled: 2, flatsPaidInFull: 1, flatsOutstanding: 1 });
  });

  it("2,000 random bill sets: Billed = Collected + Outstanding exactly, paid in full + outstanding = billed, Collected never exceeds Billed", () => {
    const r = createPrng(14_001);
    for (let n = 0; n < 2000; n++) {
      const flats = Array.from({ length: r.int(1, 8) }, (_, i) => randomFlat(r.fork(`f${n}-${i}`), i));
      const asOf = new Date(Date.UTC(2026, r.int(5, 11), r.int(1, 28))).toISOString().slice(0, 10);
      const positions = positionsOf(flats, asOf);
      const line = moneyLine(positions);
      const label = `set ${n} as of ${asOf}`;
      expect(line.billedPaise, label).toBe(line.collectedPaise + line.outstandingPaise);
      expect(line.flatsPaidInFull + line.flatsOutstanding, label).toBe(line.flatsBilled);
      expect(line.collectedPaise <= line.billedPaise, label).toBe(true);
      expect(line.collectedPaise >= 0n && line.outstandingPaise >= 0n, label).toBe(true);
      expect(line.fees.postedPaidPaise >= 0n && line.fees.postedOwingPaise >= 0n && line.fees.accruingPaise >= 0n, label).toBe(true);
      expect(line.flatsBilled, label).toBe(new Set(positions.map((p) => p.flatId)).size);
    }
  });
});

describe("RP1 collection quality", () => {
  const month = (flats: FlatSpec[], asOf = AS_OF) => collectionQuality(positionsOf(flats, asOf), asOf);

  it("no bills: nothing is counted and there is no median", () => {
    expect(month([])).toEqual({ dueOrPaid: 0, paidOnTime: 0, paid: 0, paidLate: 0, medianDaysToPay: null });
  });

  it("a bill paid on its due date is on time (the boundary), the day after is late", () => {
    const a = bill("2026-10-01", 100_000n, "2026-10-10");
    const c = bill("2026-10-01", 100_000n, "2026-10-10");
    const quality = month([flat("T01-0001", [a], [payment(a.id, 100_000n, "2026-10-10")]), flat("T01-0002", [c], [payment(c.id, 100_000n, "2026-10-11")])]);
    expect(quality).toMatchObject({ dueOrPaid: 2, paidOnTime: 1, paid: 2, paidLate: 1 });
  });

  it("an unpaid bill past its due date counts in the denominator; an unpaid bill not yet due does not", () => {
    const past = bill("2026-10-01", 100_000n, "2026-10-10");
    const future = bill("2026-10-01", 100_000n, "2026-11-10");
    const quality = month([flat("T01-0001", [past]), flat("T01-0002", [future])]);
    expect(quality).toMatchObject({ dueOrPaid: 1, paidOnTime: 0, paid: 0, paidLate: 0, medianDaysToPay: null });
  });

  it("a bill paid before its due date counts even if the due date is still ahead", () => {
    const b = bill("2026-10-01", 100_000n, "2026-11-10");
    expect(month([flat("T01-0001", [b], [payment(b.id, 100_000n, "2026-10-05")])])).toMatchObject({ dueOrPaid: 1, paidOnTime: 1, paid: 1 });
  });

  it("a part-paid bill is not paid", () => {
    const b = bill("2026-10-01", 100_000n, "2026-10-10");
    expect(month([flat("T01-0001", [b], [payment(b.id, 99_999n, "2026-10-05")])])).toMatchObject({ dueOrPaid: 1, paid: 0 });
  });

  it("days to pay run from the issue date to the day the principal was paid; the median takes the lower middle value", () => {
    const days = [2, 5, 9, 20];
    const flats = days.map((d, i) => {
      const b = bill("2026-10-01", 100_000n, "2026-10-10");
      return flat(`T01-000${i}`, [b], [payment(b.id, 100_000n, `2026-10-${String(1 + d).padStart(2, "0")}`)]);
    });
    expect(month(flats).medianDaysToPay).toBe(5);
    expect(month(flats.slice(0, 3)).medianDaysToPay).toBe(5);
    expect(month(flats.slice(0, 1)).medianDaysToPay).toBe(2);
  });

  it("a settled bill with a fee owed (FEE_ONLY) counts as paid on the day its principal was paid", () => {
    const b = bill("2026-10-01", 637_000n, "2026-10-10");
    const quality = month([flat("T01-0001", [b], [lateFee(b.id, 3_800n, "2026-10-20"), payment(b.id, 637_000n, "2026-10-20")])]);
    expect(quality).toMatchObject({ paid: 1, paidLate: 1, paidOnTime: 0, medianDaysToPay: 19 });
  });
});
