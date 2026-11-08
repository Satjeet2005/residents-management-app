import type { ChartTable } from "@/components/charts/chart-parts";
import { formatRupees } from "@/domain/money/money";
import { AGE_BUCKETS, type AgeBucket, type Ageing, type AgeingSort } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
import { percentOfPaise } from "@/domain/reports/stats";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { countText } from "./cards";

const QUERY_OF: Record<AgeBucket, string> = { NOT_YET_DUE: "not-yet-due", DAYS_1_30: "1-30", DAYS_31_60: "31-60", DAYS_61_90: "61-90", OVER_90: "over-90" };

/** The bucket named by `?bucket=`, or null for anything else (the page then shows no drill-down). */
export function bucketFromQuery(value: string | string[] | undefined): AgeBucket | null {
  const text = Array.isArray(value) ? value[0] : value;
  return AGE_BUCKETS.find((b) => QUERY_OF[b] === text) ?? null;
}

/** The order named by `?sort=`: "oldest" is oldest first; anything else, or nothing, is the default, largest first. */
export const sortFromQuery = (value: string | string[] | undefined): AgeingSort => ((Array.isArray(value) ? value[0] : value) === "oldest" ? "OLDEST" : "LARGEST");

export const sortQuery = (sort: AgeingSort): string => (sort === "OLDEST" ? "oldest" : "largest");

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

/** The age groups to list: all of them, but "Not yet due" only when something is in it ("Nothing is waiting to fall due" is not a line anyone needs). */
export const listedBuckets = (ageing: Ageing) => ageing.buckets.filter((b) => b.bucket !== "NOT_YET_DUE" || b.bills > 0);

/** A group's share of the total owed, whole percent, or null when nothing is owed. The bar of the group is scaled to the TOTAL, so the bars compare with each other. */
export const shareOfTotal = (amountPaise: bigint, ageing: Ageing): number | null => percentOfPaise(amountPaise, ageing.total.amountDuePaise);

/** The width of a group's bar in percent of the TOTAL owed (one decimal), at least 1 when the group owes anything, so a small group is still seen. */
export function barWidthPercent(amountPaise: bigint, ageing: Ageing): number {
  if (ageing.total.amountDuePaise === 0n || amountPaise === 0n) return 0;
  return Math.max(1, Number((amountPaise * 1000n) / ageing.total.amountDuePaise) / 10);
}

const billsText = (n: number): string => (n === 1 ? t("committee.ageing.billsOne") : t("committee.ageing.billsMany", { n: countText(n) }));
export { billsText };

/** The numbers behind the list: Age, Bills, Flats, Unpaid bills, Late fees, Total, with a total row; exact rupees in full Indian grouping. */
export function ageingTableOf(ageing: Ageing): ChartTable {
  const cells = (row: Ageing["total"]) => [countText(row.bills), countText(row.flats), formatRupees(row.unpaidBillsPaise), formatRupees(row.lateFeesPaise), formatRupees(row.amountDuePaise)];
  return {
    caption: t("committee.ageing.table.caption"),
    columns: [t("committee.ageing.col.age"), t("committee.ageing.col.bills"), t("committee.ageing.col.flats"), t("committee.ageing.col.unpaid"), t("committee.ageing.col.fees"), t("committee.ageing.col.total")],
    rows: [...listedBuckets(ageing).map((b) => ({ header: bucketLabel(b.bucket), cells: cells(b) })), { header: t("committee.ageing.total"), cells: cells(ageing.total) }],
  };
}

/**
 * The one sentence that ties the month's "Still unpaid" of Billed and collected to the age groups (D175): when the age group that holds the month's unpaid bills
 * holds exactly that amount, it names the group and the late fees on top ("October's unpaid bills are ₹31,39,129 (Billed and collected). The 1 to 30 days group
 * also holds late fees of ₹30,751."); otherwise it gives the totals of every month. Null with no money line or nothing owed. Exact rupees: it is a reconciliation.
 */
export function reconcileNote(input: { ageing: Ageing; money: MoneyLine | null; period: string }): string | null {
  const { ageing, money, period } = input;
  if (money === null || ageing.total.bills === 0) return null;
  const month = monthName(period);
  const group = ageing.buckets.find((b) => b.unpaidBillsPaise === money.outstandingPaise && b.bills === money.flatsOutstanding && b.bills > 0);
  return group === undefined
    ? t("committee.ageing.reconcileOther", { month, bills: formatRupees(money.outstandingPaise), all: formatRupees(ageing.total.unpaidBillsPaise), fees: formatRupees(ageing.total.lateFeesPaise) })
    : t("committee.ageing.reconcile", { month, bills: formatRupees(money.outstandingPaise), group: bucketLabel(group.bucket), fees: formatRupees(group.lateFeesPaise) });
}
