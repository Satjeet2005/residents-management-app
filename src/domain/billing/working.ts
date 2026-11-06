import type { Paise } from "../money/money";
import type { LateFeePolicy, LateFeeResult } from "./late-fee";

/**
 * The late fee worked out in the open, so a person can check it (D26, D35). Everything is a bigint: no division makes
 * a float, and each figure is rounded once, at the end, half up.
 */
export type FeeWorking = {
  /** The yearly rate as text for a sentence: "12", "12.5". */
  rateText: string;
  daysInYear: number;
  /** Each stretch of days on one balance: "balance x rate x days / year". */
  segments: readonly { basePaise: Paise; days: number }[];
  /** The exact fee in paise, rounded to the nearest paise (two decimals in rupees): 9,843 for "₹98.43". */
  exactPaise: Paise;
  /** The fee that is charged: whole rupees, in paise. Always the fee that computeLateFee returned. */
  roundedPaise: Paise;
  /** What the fee grows by in one day on the balance that is still owed, in paise, to the nearest paise. */
  dailyPaise: Paise;
};

const BPS_DENOMINATOR = 10_000n;

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** 1200 -> "12", 1250 -> "12.5", 1205 -> "12.05", 0 -> "0". Integer arithmetic only. */
export function formatRatePercent(annualRateBps: number): string {
  if (!Number.isInteger(annualRateBps) || annualRateBps < 0) throw new RangeError("annualRateBps must be a whole number, not negative");
  const whole = Math.trunc(annualRateBps / 100);
  const hundredths = annualRateBps % 100;
  if (hundredths === 0) return String(whole);
  return `${whole}.${String(hundredths).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * The working behind `result.feePaise`, or null when no day was charged (nothing to show). Throws if the working would
 * not add up to the fee computeLateFee returned, so the screen can never show a sum that disagrees with the amount.
 */
export function buildFeeWorking(result: LateFeeResult, policy: LateFeePolicy): FeeWorking | null {
  if (result.segments.length === 0) return null;
  const rate = BigInt(policy.annualRateBps);
  const year = BigInt(policy.daysInYear);
  const numerator = result.segments.reduce((sum, s) => sum + s.basePaise * BigInt(s.days) * rate, 0n);
  const denominator = BPS_DENOMINATOR * year;
  const roundedPaise = divideRoundHalfUp(numerator, denominator * 100n) * 100n;
  if (roundedPaise !== result.feePaise) throw new RangeError("The working does not add up to the late fee");
  return {
    rateText: formatRatePercent(policy.annualRateBps),
    daysInYear: policy.daysInYear,
    segments: result.segments.map((s) => ({ basePaise: s.basePaise, days: s.days })),
    exactPaise: divideRoundHalfUp(numerator, denominator),
    roundedPaise,
    dailyPaise: divideRoundHalfUp(result.outstandingPaise * rate, denominator),
  };
}
