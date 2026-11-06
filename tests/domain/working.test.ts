import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy, type LateFeePayment } from "@/domain/billing/late-fee";
import { buildFeeWorking, formatRatePercent } from "@/domain/billing/working";
import { addDays, diffDays } from "@/domain/time/calendar";
import { formatRupees, formatRupeesRounded } from "@/domain/money/money";
import { createPrng } from "@/domain/seed/prng";

const POLICY = defaultLateFeePolicy;
const fee = (billAmountPaise: bigint, dueOn: string, asOf: string, payments: LateFeePayment[] = []) =>
  computeLateFee({ billAmountPaise, dueOn, asOf, payments, holds: [], policy: POLICY });

describe("HM2 buildFeeWorking: the sample flats", () => {
  it("T12-0408 (F1): one segment of 47 days on ₹6,370, exact ₹98.43, charged ₹98, grows ₹2 a day", () => {
    const result = fee(637_000n, "2026-09-10", "2026-10-27");
    const working = buildFeeWorking(result, POLICY);
    expect(working).not.toBeNull();
    expect(working?.segments).toEqual([{ basePaise: 637_000n, days: 47 }]);
    expect(formatRupees(working?.exactPaise ?? 0n)).toBe("₹98.43");
    expect(working?.roundedPaise).toBe(9_800n);
    expect(formatRupees(working?.roundedPaise ?? 0n)).toBe("₹98");
    expect(working?.rateText).toBe("12");
    expect(working?.daysInYear).toBe(365);
    expect(working?.dailyPaise).toBe(209n);
    expect(formatRupeesRounded(working?.dailyPaise ?? 0n)).toBe("₹2");
  });

  it("T21-1601 (F2): two segments, 3 days on ₹10,660 and 15 days on ₹5,660, exact ₹38.43, charged ₹38", () => {
    const result = fee(1_066_000n, "2026-10-09", "2026-10-27", [{ date: "2026-10-12", amountPaise: 500_000n }]);
    const working = buildFeeWorking(result, POLICY);
    expect(working?.segments).toEqual([
      { basePaise: 1_066_000n, days: 3 },
      { basePaise: 566_000n, days: 15 },
    ]);
    expect(formatRupees(working?.exactPaise ?? 0n)).toBe("₹38.43");
    expect(working?.roundedPaise).toBe(3_800n);
    expect(working?.dailyPaise).toBe(186n);
  });

  it("T15-0902: the September bill (47 days) and the October bill (17 days) each have their own working", () => {
    const september = buildFeeWorking(fee(637_000n, "2026-09-10", "2026-10-27"), POLICY);
    const october = buildFeeWorking(fee(1_150_000n, "2026-10-10", "2026-10-27"), POLICY);
    expect(september?.segments[0].days).toBe(47);
    expect(october?.segments).toEqual([{ basePaise: 1_150_000n, days: 17 }]);
  });
});

describe("HM2 buildFeeWorking: edges", () => {
  it("is null when nothing is overdue", () => {
    expect(buildFeeWorking(fee(637_000n, "2026-09-10", "2026-09-10"), POLICY)).toBeNull();
    expect(buildFeeWorking(fee(637_000n, "2026-09-10", "2026-09-01"), POLICY)).toBeNull();
  });

  it("a fee that rounds to zero rupees still has working, and the charged fee is 0", () => {
    const working = buildFeeWorking(fee(10_000n, "2026-09-10", "2026-09-11"), POLICY);
    expect(working?.roundedPaise).toBe(0n);
    expect(working?.exactPaise).toBe(3n);
  });

  it("exact figures need no floating point: an amount far above 2^53 is still exact", () => {
    const bill = 123_456_789_012_345_678_900n;
    const result = fee(bill, "2026-09-10", "2026-10-27");
    const working = buildFeeWorking(result, POLICY);
    const numerator = bill * 1200n * 47n;
    expect(working?.exactPaise).toBe((2n * numerator + 3_650_000n) / (2n * 3_650_000n));
    expect(working?.roundedPaise).toBe(result.feePaise);
  });

  it("uses the policy's rate and year length", () => {
    const policy = { annualRateBps: 1850, capBps: 2100, daysInYear: 360 };
    const result = computeLateFee({ billAmountPaise: 100_000n, dueOn: "2026-09-10", asOf: "2026-10-10", payments: [], holds: [], policy });
    const working = buildFeeWorking(result, policy);
    expect(working?.rateText).toBe("18.5");
    expect(working?.daysInYear).toBe(360);
    expect(working?.roundedPaise).toBe(result.feePaise);
  });

  it("days skipped by a hold are not in the working (the segments are the charged days)", () => {
    const result = computeLateFee({
      billAmountPaise: 637_000n,
      dueOn: "2026-09-10",
      asOf: "2026-10-27",
      payments: [],
      holds: [{ startedAt: Date.UTC(2026, 8, 14, 18, 30), endedAt: Date.UTC(2026, 8, 17, 18, 30) }],
      policy: POLICY,
    });
    const working = buildFeeWorking(result, POLICY);
    expect(working?.segments.reduce((n, s) => n + s.days, 0)).toBe(result.chargedDays);
    expect(working?.roundedPaise).toBe(result.feePaise);
  });
});

describe("HM2 formatRatePercent", () => {
  it.each([[1200, "12"], [2100, "21"], [1250, "12.5"], [1205, "12.05"], [1299, "12.99"], [50, "0.5"], [5, "0.05"], [0, "0"], [100, "1"]])("%i bps is %s%%", (bps, text) => {
    expect(formatRatePercent(bps)).toBe(text);
  });
  it.each([-1, 1.5, Number.NaN])("rejects %s", (bps) => {
    expect(() => formatRatePercent(bps)).toThrow(RangeError);
  });
});

describe("HM2 property: the working agrees with an independent day-by-day BigInt computation", () => {
  it("1,500 seeded random bills with part payments", () => {
    const rng = createPrng(97);
    for (let i = 0; i < 1500; i++) {
      const bill = BigInt(rng.int(10_000, 5_000_000));
      const dueOn = addDays("2026-01-10", rng.int(0, 200));
      const asOf = addDays(dueOn, rng.int(1, 120));
      const payments: LateFeePayment[] = Array.from({ length: rng.int(0, 3) }, () => ({
        date: addDays(dueOn, rng.int(-5, diffDays(dueOn, asOf))),
        amountPaise: BigInt(rng.int(1_000, Number(bill / 2n))),
      }));
      const result = fee(bill, dueOn, asOf, payments);
      const working = buildFeeWorking(result, POLICY);

      // Independent: for every overdue day, the balance is the bill less payments dated before that day.
      let numerator = 0n;
      for (let day = 1; day <= diffDays(dueOn, asOf); day++) {
        const date = addDays(dueOn, day);
        const paid = payments.filter((p) => p.date < date).reduce((s, p) => s + p.amountPaise, 0n);
        numerator += (bill > paid ? bill - paid : 0n) * 1200n;
      }
      const expectedExact = (2n * numerator + 3_650_000n) / (2n * 3_650_000n);
      if (working === null) {
        expect(numerator).toBe(0n);
      } else {
        expect(working.exactPaise, `case ${i}`).toBe(expectedExact);
        expect(working.roundedPaise, `case ${i}`).toBe(result.feePaise);
        expect(working.segments.reduce((s, x) => s + x.basePaise * BigInt(x.days) * 1200n, 0n)).toBe(numerator);
      }
    }
  });
});

describe("HM2 the working code does not use floating point", () => {
  it("working.ts has no Number(), parseFloat, toFixed or Math calls on money", () => {
    const source = readFileSync("src/domain/billing/working.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/\b(parseFloat|toFixed|toPrecision)\b/);
    expect(source).not.toMatch(/\bNumber\(/);
    expect(source.match(/\bMath\.\w+/g) ?? []).toEqual(["Math.trunc"]);
  });
});
