import { t } from "@/lib/messages";
import { LANES, type Lane, type SummaryCounts } from "./types";

/**
 * Whole-number widths (percent) for a segmented bar: they add up to exactly 100 (largest remainder), and a count above zero
 * never gets a zero width, so a single row is still a visible sliver. All zero counts give all zero widths.
 */
export function barWidths(counts: readonly number[]): number[] {
  if (counts.some((c) => !Number.isInteger(c) || c < 0)) throw new RangeError("Counts must be whole numbers, not negative");
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c * 100) / total);
  const widths = exact.map(Math.floor);
  let spare = 100 - widths.reduce((sum, w) => sum + w, 0);
  const byRemainder = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (spare === 0) break;
    widths[index] += 1;
    spare -= 1;
  }
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && widths[i] === 0) {
      const donor = widths.reduce((best, w, j) => (w > widths[best] ? j : best), 0);
      widths[donor] -= 1;
      widths[i] = 1;
    }
  }
  return widths;
}

export type LaneShare = { lane: Lane; count: number; width: number };

/** The four lanes in the order of the selector with their share of the bar: the widths add up to 100 (largest remainder) and a lane above zero is never invisible. */
export function laneShares(laneCounts: Record<Lane, number>): LaneShare[] {
  const widths = barWidths(LANES.map((lane) => laneCounts[lane]));
  return LANES.map((lane, index) => ({ lane, count: laneCounts[lane], width: widths[index] }));
}

/** The accounted line of the header. It says "accounted for" only when the flag read back from the database is true; then no action may be offered. */
export function accountedLine(counts: Pick<SummaryCounts, "accounted" | "rowsRead">): { ok: boolean; text: string } {
  return counts.accounted ? { ok: true, text: t("recon.accounted", { n: counts.rowsRead }) } : { ok: false, text: t("recon.notAccounted") };
}

/** Actions are offered only for an import whose books add up. */
export const actionsAllowed = (counts: Pick<SummaryCounts, "accounted">): boolean => counts.accounted;
