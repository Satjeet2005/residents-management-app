import { describe, expect, it } from "vitest";
import {
  type LateFeeHold,
  type LateFeeInput,
  type LateFeePayment,
  amountDuePaise,
  computeLateFee,
  defaultLateFeePolicy,
  validateLateFeePolicy,
} from "@/domain/billing/late-fee";
import { addDays, dayStartInstant } from "@/domain/time/calendar";

/** mulberry32: a tiny deterministic generator, so failures are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** T12-0408: ₹6,370 due 2026-09-10, no payments, as of 2026-10-27 unless overridden. */
const t12 = (overrides: Partial<LateFeeInput> = {}): LateFeeInput => ({
  billAmountPaise: 637000n,
  dueOn: "2026-09-10",
  asOf: "2026-10-27",
  payments: [],
  holds: [],
  policy: defaultLateFeePolicy,
  ...overrides,
});

/** T21-1601: ₹10,660 due 2026-10-09 with ₹5,000 paid on 2026-10-12. */
const t21 = (overrides: Partial<LateFeeInput> = {}): LateFeeInput => ({
  billAmountPaise: 1066000n,
  dueOn: "2026-10-09",
  asOf: "2026-10-27",
  payments: [{ date: "2026-10-12", amountPaise: 500000n }],
  holds: [],
  policy: defaultLateFeePolicy,
  ...overrides,
});

/** An instant `hours` hours after 00:00 IST on `date`. */
const ist = (date: string, hours: number) => dayStartInstant(date) + hours * 3_600_000;

describe("F1 T12-0408: ₹6,370 due 2026-09-10, as of 2026-10-27, no payments", () => {
  it("charges 47 days: exact ₹98.43, fee ₹98, amount due ₹6,468", () => {
    const result = computeLateFee(t12());
    expect(result.overdueDays).toBe(47);
    expect(result.skippedDays).toBe(0);
    expect(result.chargedDays).toBe(47);
    // 637000 x 1200 x 47 / (10000 x 365) = 35_926_800_000 / 3_650_000 = 9842.96 paise = ₹98.43, rounded once to ₹98.
    expect(result.feePaise).toBe(9800n);
    expect(result.outstandingPaise).toBe(637000n);
    expect(amountDuePaise(result)).toBe(646800n);
    expect(result.segments).toEqual([
      { fromDate: "2026-09-11", toDate: "2026-10-27", days: 47, basePaise: 637000n },
    ]);
  });
});

describe("F2 T21-1601: ₹10,660 due 2026-10-09, ₹5,000 paid 2026-10-12, as of 2026-10-27", () => {
  it("splits into 3 days at the full bill and 15 days after the payment: exact ₹38.43, fee ₹38", () => {
    const result = computeLateFee(t21());
    expect(result.overdueDays).toBe(18);
    expect(result.segments).toEqual([
      { fromDate: "2026-10-10", toDate: "2026-10-12", days: 3, basePaise: 1066000n },
      { fromDate: "2026-10-13", toDate: "2026-10-27", days: 15, basePaise: 566000n },
    ]);
    // 1200 x (3 x 1066000 + 15 x 566000) / 3650000 = 14_025_600_000 / 3_650_000 = 3842.63 paise = ₹38.43, rounded once to ₹38.
    expect(result.feePaise).toBe(3800n);
    expect(result.outstandingPaise).toBe(566000n);
    expect(amountDuePaise(result)).toBe(569800n);
  });
});

describe("F3 the same bill due 2026-10-10", () => {
  it("as of 2026-10-27: 17 overdue days, fee ₹35", () => {
    const result = computeLateFee(t21({ dueOn: "2026-10-10" }));
    expect(result.overdueDays).toBe(17);
    expect(result.feePaise).toBe(3500n);
  });

  it("as of 2026-10-28: 18 overdue days, [2 @ ₹10,660, 16 @ ₹5,660], fee ₹37", () => {
    const result = computeLateFee(t21({ dueOn: "2026-10-10", asOf: "2026-10-28" }));
    expect(result.overdueDays).toBe(18);
    expect(result.segments).toEqual([
      { fromDate: "2026-10-11", toDate: "2026-10-12", days: 2, basePaise: 1066000n },
      { fromDate: "2026-10-13", toDate: "2026-10-28", days: 16, basePaise: 566000n },
    ]);
    expect(result.feePaise).toBe(3700n);
  });
});

describe("F4 T12 on later days", () => {
  it("as of 2026-10-28: 48 days, fee ₹101", () => {
    const result = computeLateFee(t12({ asOf: "2026-10-28" }));
    expect(result.overdueDays).toBe(48);
    expect(result.feePaise).toBe(10100n);
  });

  it("as of 2026-10-29: 49 days, fee ₹103", () => {
    const result = computeLateFee(t12({ asOf: "2026-10-29" }));
    expect(result.overdueDays).toBe(49);
    expect(result.feePaise).toBe(10300n);
  });
});

describe("F5 a skipped day", () => {
  const hold: LateFeeHold = { startedAt: ist("2026-10-27", 18), endedAt: ist("2026-10-28", 21) };

  it("T12 as of 2026-10-30 with a hold 27 Oct 18:00 to 28 Oct 21:00 IST skips 28 Oct only", () => {
    const result = computeLateFee(t12({ asOf: "2026-10-30", holds: [hold] }));
    expect(result.overdueDays).toBe(50);
    expect(result.skippedDays).toBe(1);
    expect(result.chargedDays).toBe(49);
    expect(result.feePaise).toBe(10300n);
    expect(amountDuePaise(result)).toBe(647300n);
  });

  it("the skipped day splits the segments and belongs to none", () => {
    const result = computeLateFee(t12({ asOf: "2026-10-30", holds: [hold] }));
    expect(result.segments).toEqual([
      { fromDate: "2026-09-11", toDate: "2026-10-27", days: 47, basePaise: 637000n },
      { fromDate: "2026-10-29", toDate: "2026-10-30", days: 2, basePaise: 637000n },
    ]);
    expect(result.segments.reduce((sum, s) => sum + s.days, 0)).toBe(result.chargedDays);
  });
});

describe("F6 a released hold", () => {
  it("T12 as of 2026-10-31 with a hold 27 Oct 18:00 to 29 Oct 11:00 IST skips 2 days, fee ₹103", () => {
    const hold: LateFeeHold = { startedAt: ist("2026-10-27", 18), endedAt: ist("2026-10-29", 11) };
    const result = computeLateFee(t12({ asOf: "2026-10-31", holds: [hold] }));
    expect(result.overdueDays).toBe(51);
    expect(result.skippedDays).toBe(2);
    expect(result.chargedDays).toBe(49);
    expect(result.feePaise).toBe(10300n);
  });

  it("a hold that starts at 18:00 on 27 Oct does not skip 27 Oct: the day began before the hold", () => {
    const open: LateFeeHold = { startedAt: ist("2026-10-27", 18), endedAt: null };
    const result = computeLateFee(t12({ asOf: "2026-10-27", holds: [open] }));
    expect(result.skippedDays).toBe(0);
    expect(result.chargedDays).toBe(47);
    expect(result.feePaise).toBe(9800n);
  });

  it("an open hold skips every later day", () => {
    const open: LateFeeHold = { startedAt: ist("2026-10-27", 18), endedAt: null };
    const result = computeLateFee(t12({ asOf: "2026-10-30", holds: [open] }));
    expect(result.skippedDays).toBe(3);
    expect(result.chargedDays).toBe(47);
  });
});

describe("F6 hold boundaries are half-open: [startedAt, endedAt)", () => {
  it("a hold ending exactly at a day's start does not skip that day", () => {
    const hold: LateFeeHold = { startedAt: ist("2026-10-27", 18), endedAt: dayStartInstant("2026-10-29") };
    const result = computeLateFee(t12({ asOf: "2026-10-30", holds: [hold] }));
    expect(result.skippedDays).toBe(1);
    expect(result.segments.map((s) => s.fromDate)).toEqual(["2026-09-11", "2026-10-29"]);
  });

  it("a hold starting exactly at a day's start skips that day", () => {
    const hold: LateFeeHold = { startedAt: dayStartInstant("2026-10-28"), endedAt: ist("2026-10-28", 5) };
    const result = computeLateFee(t12({ asOf: "2026-10-30", holds: [hold] }));
    expect(result.skippedDays).toBe(1);
    expect(result.segments.map((s) => s.fromDate)).toEqual(["2026-09-11", "2026-10-29"]);
  });

  it("an empty hold (start equals end) skips nothing", () => {
    const instant = dayStartInstant("2026-10-28");
    const result = computeLateFee(t12({ asOf: "2026-10-30", holds: [{ startedAt: instant, endedAt: instant }] }));
    expect(result.skippedDays).toBe(0);
  });

  it("overlapping holds skip a day once", () => {
    const holds: LateFeeHold[] = [
      { startedAt: ist("2026-10-27", 18), endedAt: ist("2026-10-28", 21) },
      { startedAt: ist("2026-10-28", 1), endedAt: ist("2026-10-28", 2) },
    ];
    expect(computeLateFee(t12({ asOf: "2026-10-30", holds })).skippedDays).toBe(1);
  });
});

describe("F7 the cap", () => {
  it("T12 as of 2026-10-27 at 21%: exact ₹172.25, fee ₹172", () => {
    // 637000 x 2100 x 47 / 3650000 = 62_871_900_000 / 3_650_000 = 17225.18 paise = ₹172.25, rounded to ₹172.
    const result = computeLateFee(t12({ policy: { annualRateBps: 2100, capBps: 2100, daysInYear: 365 } }));
    expect(result.feePaise).toBe(17200n);
  });

  it("an annualRateBps above capBps throws RangeError", () => {
    expect(() => computeLateFee(t12({ policy: { annualRateBps: 2500, capBps: 2100, daysInYear: 365 } }))).toThrow(
      RangeError,
    );
  });
});

describe("validateLateFeePolicy", () => {
  it("accepts the default policy and a cap above 21% (the 21% limit is not enforced here)", () => {
    expect(() => validateLateFeePolicy(defaultLateFeePolicy)).not.toThrow();
    expect(() => validateLateFeePolicy({ annualRateBps: 3000, capBps: 3500, daysInYear: 365 })).not.toThrow();
    expect(() => validateLateFeePolicy({ annualRateBps: 0, capBps: 0, daysInYear: 1 })).not.toThrow();
  });

  it.each([
    [{ annualRateBps: 1200.5, capBps: 2100, daysInYear: 365 }],
    [{ annualRateBps: 1200, capBps: 2100.5, daysInYear: 365 }],
    [{ annualRateBps: 1200, capBps: 2100, daysInYear: 365.25 }],
    [{ annualRateBps: Number.NaN, capBps: 2100, daysInYear: 365 }],
    [{ annualRateBps: -1, capBps: 2100, daysInYear: 365 }],
    [{ annualRateBps: 2101, capBps: 2100, daysInYear: 365 }],
    [{ annualRateBps: 1200, capBps: 2100, daysInYear: 0 }],
    [{ annualRateBps: 1200, capBps: 2100, daysInYear: -365 }],
  ])("rejects %j with RangeError", (policy) => {
    expect(() => validateLateFeePolicy(policy)).toThrow(RangeError);
  });
});

describe("F8 edge cases", () => {
  it.each([
    ["before the due date", "2026-09-09"],
    ["on the due date", "2026-09-10"],
  ])("as of a date %s the fee is 0 and nothing is overdue", (_label, asOf) => {
    const result = computeLateFee(t12({ asOf }));
    expect(result.overdueDays).toBe(0);
    expect(result.chargedDays).toBe(0);
    expect(result.feePaise).toBe(0n);
    expect(result.segments).toEqual([]);
    expect(result.outstandingPaise).toBe(637000n);
    expect(amountDuePaise(result)).toBe(637000n);
  });

  it("a bill paid in full on the due date has no fee and nothing outstanding", () => {
    const result = computeLateFee(t12({ payments: [{ date: "2026-09-10", amountPaise: 637000n }] }));
    expect(result.overdueDays).toBe(47);
    expect(result.feePaise).toBe(0n);
    expect(result.outstandingPaise).toBe(0n);
    expect(amountDuePaise(result)).toBe(0n);
  });

  it("a payment before the due date reduces the base from dueOn + 1", () => {
    // ₹2,000 on 2026-09-05: 437000 x 1200 x 47 / 3650000 = 24_646_800_000 / 3_650_000 = 6752.55 paise = ₹67.53, rounded to ₹68.
    const result = computeLateFee(t12({ payments: [{ date: "2026-09-05", amountPaise: 200000n }] }));
    expect(result.segments).toEqual([
      { fromDate: "2026-09-11", toDate: "2026-10-27", days: 47, basePaise: 437000n },
    ]);
    expect(result.feePaise).toBe(6800n);
    expect(result.outstandingPaise).toBe(437000n);
  });

  it("a payment reduces the balance from the day after its date, not on it", () => {
    const result = computeLateFee(t12({ payments: [{ date: "2026-09-20", amountPaise: 100000n }] }));
    expect(result.segments[0]).toEqual({
      fromDate: "2026-09-11",
      toDate: "2026-09-20",
      days: 10,
      basePaise: 637000n,
    });
    expect(result.segments[1].fromDate).toBe("2026-09-21");
    expect(result.segments[1].basePaise).toBe(537000n);
  });

  it("an overpayment floors the base and the outstanding amount at 0", () => {
    // ₹7,000 on 2026-09-20: 10 days at ₹6,370, then 37 days at 0. 637000 x 1200 x 10 / 3650000 = ₹20.94 -> ₹21.
    const result = computeLateFee(t12({ payments: [{ date: "2026-09-20", amountPaise: 700000n }] }));
    expect(result.segments).toEqual([
      { fromDate: "2026-09-11", toDate: "2026-09-20", days: 10, basePaise: 637000n },
      { fromDate: "2026-09-21", toDate: "2026-10-27", days: 37, basePaise: 0n },
    ]);
    expect(result.feePaise).toBe(2100n);
    expect(result.outstandingPaise).toBe(0n);
  });

  it("payments dated after asOf are ignored", () => {
    const withLate = computeLateFee(t12({ payments: [{ date: "2026-10-28", amountPaise: 637000n }] }));
    expect(withLate).toEqual(computeLateFee(t12()));
    expect(withLate.outstandingPaise).toBe(637000n);
  });

  it("a payment on asOf counts toward the outstanding amount but not the fee base", () => {
    const result = computeLateFee(t12({ payments: [{ date: "2026-10-27", amountPaise: 100000n }] }));
    expect(result.feePaise).toBe(9800n);
    expect(result.outstandingPaise).toBe(537000n);
  });

  it("unsorted payments give the same result as sorted ones", () => {
    const payments: LateFeePayment[] = [
      { date: "2026-10-05", amountPaise: 200000n },
      { date: "2026-09-20", amountPaise: 100000n },
      { date: "2026-10-05", amountPaise: 50000n },
    ];
    const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
    const result = computeLateFee(t12({ payments }));
    expect(result).toEqual(computeLateFee(t12({ payments: sorted })));
    expect(result).toEqual(computeLateFee(t12({ payments: [...payments].reverse() })));
    expect(result.outstandingPaise).toBe(287000n);
  });

  it.each([0n, -1n, -500000n])("a payment amount of %s throws RangeError", (amountPaise) => {
    expect(() => computeLateFee(t12({ payments: [{ date: "2026-09-20", amountPaise }] }))).toThrow(RangeError);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-1-1", "", "tomorrow"])("an invalid date %j throws RangeError", (date) => {
    expect(() => computeLateFee(t12({ dueOn: date }))).toThrow(RangeError);
    expect(() => computeLateFee(t12({ asOf: date }))).toThrow(RangeError);
    expect(() => computeLateFee(t12({ payments: [{ date, amountPaise: 100n }] }))).toThrow(RangeError);
  });

  it.each([0n, -637000n])("a bill amount of %s throws RangeError", (billAmountPaise) => {
    expect(() => computeLateFee(t12({ billAmountPaise }))).toThrow(RangeError);
  });

  it("invalid holds throw RangeError", () => {
    expect(() => computeLateFee(t12({ holds: [{ startedAt: Number.NaN, endedAt: null }] }))).toThrow(RangeError);
    expect(() => computeLateFee(t12({ holds: [{ startedAt: 1, endedAt: Number.NaN }] }))).toThrow(RangeError);
    expect(() => computeLateFee(t12({ holds: [{ startedAt: 10, endedAt: 5 }] }))).toThrow(RangeError);
  });
});

describe("F9 leap days and year boundaries", () => {
  it("due 2028-02-28 as of 2028-03-02: 3 overdue days (29 Feb, 1 Mar, 2 Mar)", () => {
    const result = computeLateFee(t12({ dueOn: "2028-02-28", asOf: "2028-03-02" }));
    expect(result.overdueDays).toBe(3);
    expect(result.segments[0]).toMatchObject({ fromDate: "2028-02-29", toDate: "2028-03-02", days: 3 });
  });

  it("due 2026-12-30 as of 2027-01-02: 3 overdue days", () => {
    const result = computeLateFee(t12({ dueOn: "2026-12-30", asOf: "2027-01-02" }));
    expect(result.overdueDays).toBe(3);
    expect(result.segments[0]).toMatchObject({ fromDate: "2026-12-31", toDate: "2027-01-02", days: 3 });
  });

  it("the year stays 365 days in a leap year: 366 days overdue costs 366/365 of a year", () => {
    // 637000 x 1200 x 366 / 3650000 = 76649.42 paise = ₹766.49 -> ₹766. A 366-day year would give exactly ₹764.40 -> ₹764.
    const result = computeLateFee(t12({ dueOn: "2028-01-01", asOf: "2029-01-01" }));
    expect(result.overdueDays).toBe(366);
    expect(result.feePaise).toBe(76600n);
  });

  it("365 days in 2028 give exactly ₹764.40 -> ₹764", () => {
    const result = computeLateFee(t12({ dueOn: "2028-01-01", asOf: "2028-12-31" }));
    expect(result.overdueDays).toBe(365);
    expect(result.feePaise).toBe(76400n);
  });
});

describe("F10 big numbers", () => {
  it("a ₹1,00,00,000 bill for 365 days at 12% is exactly ₹12,00,000", () => {
    // 1_000_000_000 paise x 1200 x 365 / (10000 x 365) = 120_000_000 paise = ₹1,200,000 with no remainder.
    const result = computeLateFee(
      t12({ billAmountPaise: 1_000_000_000n, dueOn: "2026-01-01", asOf: "2027-01-01" }),
    );
    expect(result.overdueDays).toBe(365);
    expect(1_000_000_000n * 1200n * 365n % (10_000n * 365n * 100n)).toBe(0n);
    expect(result.feePaise).toBe(120_000_000n);
    expect(result.outstandingPaise).toBe(1_000_000_000n);
  });

  it("a bill of 2^63 - 1 paise does not overflow: exact ₹11,068,046,444,225,730.97, fee ₹11,068,046,444,225,731", () => {
    const bill = 9_223_372_036_854_775_807n;
    const result = computeLateFee(t12({ billAmountPaise: bill, dueOn: "2026-01-01", asOf: "2027-01-01" }));
    expect(result.feePaise).toBe(1_106_804_644_422_573_100n);
    expect(result.outstandingPaise).toBe(bill);
  });
});

describe("F11 rounding: once, at the end, half up", () => {
  it("an exact ₹1.50 rounds up to ₹2", () => {
    // 456250 paise x 1200 bps x 1 day / (10000 x 365) = 547_500_000 / 3_650_000 = 150 paise = ₹1.50 exactly.
    const result = computeLateFee(t12({ billAmountPaise: 456250n, asOf: "2026-09-11" }));
    expect(result.overdueDays).toBe(1);
    expect(result.feePaise).toBe(200n);
  });

  it("an exact ₹2.50 rounds up to ₹3 (half up, not half to even)", () => {
    // 912500 paise x 1000 bps x 1 day / (10000 x 365) = 912_500_000 / 3_650_000 = 250 paise = ₹2.50 exactly.
    const policy = { annualRateBps: 1000, capBps: 2100, daysInYear: 365 };
    const result = computeLateFee(t12({ billAmountPaise: 912500n, asOf: "2026-09-11", policy }));
    expect(result.feePaise).toBe(300n);
  });

  it("just below a half rounds down: 149.9997 paise -> ₹1", () => {
    const result = computeLateFee(t12({ billAmountPaise: 456249n, asOf: "2026-09-11" }));
    expect(result.feePaise).toBe(100n);
  });

  it("the fee is the rounding of the exact total, not the sum of rounded days (F1: 47 x ₹2 would be ₹94)", () => {
    expect(computeLateFee(t12()).feePaise).toBe(9800n);
  });
});

function randomInput(random: () => number): LateFeeInput {
  const bill = BigInt(1 + Math.floor(random() * 500_000_000));
  const dueOn = addDays("2026-01-01", Math.floor(random() * 365));
  const asOf = addDays(dueOn, Math.floor(random() * 500) - 30);
  const payments: LateFeePayment[] = [];
  for (let i = Math.floor(random() * 5); i > 0; i--) {
    payments.push({
      date: addDays(dueOn, Math.floor(random() * 600) - 100),
      amountPaise: BigInt(1 + Math.floor(random() * Number(bill) * 1.2)),
    });
  }
  const holds: LateFeeHold[] = [];
  for (let i = Math.floor(random() * 3); i > 0; i--) {
    const startedAt = dayStartInstant(dueOn) + Math.floor(random() * 500 * 86_400_000);
    const open = random() < 0.2;
    holds.push({ startedAt, endedAt: open ? null : startedAt + Math.floor(random() * 10 * 86_400_000) });
  }
  const annualRateBps = Math.floor(random() * 2101);
  return { billAmountPaise: bill, dueOn, asOf, payments, holds, policy: { annualRateBps, capBps: 2100, daysInYear: 365 } };
}

describe("F12 properties over 2,000 seeded random cases", () => {
  const random = seededRandom(20261104);
  const cases = Array.from({ length: 2000 }, () => randomInput(random));

  it("fee is never negative and is a whole number of rupees", () => {
    for (const input of cases) {
      const { feePaise } = computeLateFee(input);
      expect(feePaise >= 0n).toBe(true);
      expect(feePaise % 100n).toBe(0n);
    }
  });

  it("fee never increases when a payment is added", () => {
    const extra = seededRandom(7);
    for (const input of cases) {
      const before = computeLateFee(input).feePaise;
      const payment: LateFeePayment = {
        date: addDays(input.dueOn, Math.floor(extra() * 600) - 100),
        amountPaise: BigInt(1 + Math.floor(extra() * Number(input.billAmountPaise))),
      };
      const after = computeLateFee({ ...input, payments: [...input.payments, payment] }).feePaise;
      expect(after <= before).toBe(true);
    }
  });

  it("chargedDays never exceeds overdueDays, and skipped plus charged equals overdue", () => {
    for (const input of cases) {
      const result = computeLateFee(input);
      expect(result.chargedDays).toBeLessThanOrEqual(result.overdueDays);
      expect(result.skippedDays + result.chargedDays).toBe(result.overdueDays);
    }
  });

  it("segments' day counts sum to chargedDays, and every segment is a contiguous run", () => {
    for (const input of cases) {
      const result = computeLateFee(input);
      expect(result.segments.reduce((sum, s) => sum + s.days, 0)).toBe(result.chargedDays);
      for (const s of result.segments) {
        expect(s.days).toBeGreaterThan(0);
        expect(addDays(s.fromDate, s.days - 1)).toBe(s.toDate);
        expect(s.basePaise >= 0n && s.basePaise <= input.billAmountPaise).toBe(true);
      }
    }
  });

  it("outstanding never exceeds the bill, and the amount due is outstanding plus fee", () => {
    for (const input of cases) {
      const result = computeLateFee(input);
      expect(result.outstandingPaise >= 0n).toBe(true);
      expect(result.outstandingPaise <= input.billAmountPaise).toBe(true);
      expect(amountDuePaise(result)).toBe(result.outstandingPaise + result.feePaise);
    }
  });

  it("the order of payments does not matter", () => {
    for (const input of cases) {
      expect(computeLateFee({ ...input, payments: [...input.payments].reverse() })).toEqual(computeLateFee(input));
    }
  });

  it("a later asOf never lowers the fee", () => {
    for (const input of cases) {
      const earlier = computeLateFee(input).feePaise;
      const later = computeLateFee({ ...input, asOf: addDays(input.asOf, 1) }).feePaise;
      expect(later >= earlier).toBe(true);
    }
  });
});
