import { t } from "@/lib/messages";
import type { SummaryCounts } from "./types";

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

export type SegmentKey = "AUTO" | "MANUAL" | "NEEDS_YOU" | "AWAITING" | "NOT_MAINTENANCE" | "ALREADY";
export type Segment = { key: SegmentKey; label: string; count: number; width: number };

/**
 * The segments of the summary bar, in order. "Posted by hand" and "Already imported" appear only above zero; the other three always
 * do. Every segment has a text label and its number, never colour alone.
 */
export function summarySegments(counts: SummaryCounts): Segment[] {
  const all: { key: SegmentKey; label: string; count: number; always: boolean }[] = [
    { key: "AUTO", label: t("recon.segment.auto"), count: counts.autoMatched, always: true },
    { key: "MANUAL", label: t("recon.segment.manual"), count: counts.manuallyMatched, always: false },
    { key: "NEEDS_YOU", label: t("recon.segment.needsYou"), count: counts.needsYou, always: true },
    { key: "AWAITING", label: t("recon.segment.awaiting"), count: counts.awaitingApproval, always: true },
    { key: "NOT_MAINTENANCE", label: t("recon.segment.notMaintenance"), count: counts.notMaintenance, always: true },
    { key: "ALREADY", label: t("recon.segment.already"), count: counts.alreadyImported, always: false },
  ];
  const shown = all.filter((s) => s.always || s.count > 0);
  const widths = barWidths(shown.map((s) => s.count));
  return shown.map((s, i) => ({ key: s.key, label: s.label, count: s.count, width: widths[i] }));
}

/** The line under the bar. It says "accounted for" only when the flag read back from the database is true; then no action may be offered. */
export function accountedLine(counts: Pick<SummaryCounts, "accounted" | "rowsRead">): { ok: boolean; text: string } {
  return counts.accounted ? { ok: true, text: t("recon.accounted", { n: counts.rowsRead }) } : { ok: false, text: t("recon.notAccounted") };
}

/** Actions are offered only for an import whose books add up. */
export const actionsAllowed = (counts: Pick<SummaryCounts, "accounted">): boolean => counts.accounted;
