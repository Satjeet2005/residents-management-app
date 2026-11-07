import { AGE_BUCKETS, type AgeBucket } from "@/domain/reports/age";
import { t } from "@/lib/messages";
import { barWidths } from "@/lib/reconciliation/summary";

const QUERY_OF: Record<AgeBucket, string> = { NOT_YET_DUE: "not-yet-due", DAYS_1_30: "1-30", DAYS_31_60: "31-60", DAYS_61_90: "61-90", OVER_90: "over-90" };

/** The bucket named by `?bucket=`, or null for anything else (the page then shows no drill-down). */
export function bucketFromQuery(value: string | string[] | undefined): AgeBucket | null {
  const text = Array.isArray(value) ? value[0] : value;
  return AGE_BUCKETS.find((b) => QUERY_OF[b] === text) ?? null;
}

export const bucketQuery = (bucket: AgeBucket): string => QUERY_OF[bucket];

export function bucketLabel(bucket: AgeBucket): string {
  switch (bucket) {
    case "NOT_YET_DUE":
      return t("committee.bucket.notYetDue");
    case "DAYS_1_30":
      return t("committee.bucket.days1to30");
    case "DAYS_31_60":
      return t("committee.bucket.days31to60");
    case "DAYS_61_90":
      return t("committee.bucket.days61to90");
    case "OVER_90":
      return t("committee.bucket.over90");
  }
}

/**
 * Whole-number widths (percent) of the five segments of the ageing bar, from each bucket's amount due: they add up to exactly 100 and an amount above zero is
 * never zero wide. All zero gives all zero. (Amounts are paise below 2^53, so Number is exact.)
 */
export const ageingWidths = (amountsPaise: readonly bigint[]): number[] => barWidths(amountsPaise.map(Number));
