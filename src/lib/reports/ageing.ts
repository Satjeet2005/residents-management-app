import type { DataColumn, DataRow } from "@/components/committee/data-table";
import { formatRupees } from "@/domain/money/money";
import { AGE_BUCKETS, type AgeBucket, type Ageing, type AgeingSort } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
import { monthName } from "@/lib/format-date";
import { t } from "@/lib/messages";
import { countText, flatsText } from "./cards";
import { sharesOf } from "./shares";

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

/** The address of the flats page of an age group, in the order asked for (the default, largest first, is left out). */
export const flatsHref = (bucket: AgeBucket, sort: AgeingSort = "LARGEST"): string => `/staff/reports/dues/flats?bucket=${QUERY_OF[bucket]}${sort === "OLDEST" ? "&sort=oldest" : ""}`;

/** Where an old inline address (`/staff/reports/dues?bucket=...`, or the overview's) now goes: the flats page of the same group and order; null when it names no group. */
export function legacyFlatsTarget(query: Record<string, string | string[] | undefined>): string | null {
  const bucket = bucketFromQuery(query.bucket);
  return bucket === null ? null : flatsHref(bucket, sortFromQuery(query.sort));
}

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

/** The shares of the age groups in whole percent, by group, adding to exactly 100 (largest remainder, D214); every group is 0 when nothing is owed. */
export function groupShares(ageing: Ageing): Record<AgeBucket, number> {
  const shares = sharesOf(ageing.buckets.map((b) => b.amountDuePaise));
  return Object.fromEntries(ageing.buckets.map((b, i) => [b.bucket, shares[i]])) as Record<AgeBucket, number>;
}

/** The count a row of the age list states: its bills, except "Over 90 days", which states the flats (the number to chase). */
export const rowCountText = (bucket: AgeBucket, row: { bills: number; flats: number }): string => (bucket === "OVER_90" ? flatsText(row.flats) : billsText(row.bills));

/** The width of a group's bar in percent of the TOTAL owed (one decimal), at least 1 when the group owes anything, so a small group is still seen. */
export function barWidthPercent(amountPaise: bigint, ageing: Ageing): number {
  if (ageing.total.amountDuePaise === 0n || amountPaise === 0n) return 0;
  return Math.max(1, Number((amountPaise * 1000n) / ageing.total.amountDuePaise) / 10);
}

const billsText = (n: number): string => (n === 1 ? t("committee.ageing.billsOne") : t("committee.ageing.billsMany", { n: countText(n) }));
export { billsText };

/**
 * The numbers behind the list as a real table: Age, Bills, Flats, Unpaid bills, Late fees, Total, and a total row whose Total is Total owed (the one place that figure
 * is repeated, D214). A phone shows four columns (Age, Bills, Unpaid bills, Late fees); Flats and Total come from 768px.
 */
export function ageingTableOf(ageing: Ageing): { caption: string; columns: DataColumn[]; rows: DataRow[] } {
  const cells = (row: Ageing["total"]) => [countText(row.bills), countText(row.flats), formatRupees(row.unpaidBillsPaise), formatRupees(row.lateFeesPaise), formatRupees(row.amountDuePaise)];
  return {
    caption: t("committee.ageing.table.caption"),
    columns: [
      { label: t("committee.ageing.col.age"), phone: true },
      { label: t("committee.ageing.col.bills"), phone: true },
      { label: t("committee.ageing.col.flats"), phone: false },
      { label: t("committee.ageing.col.unpaid"), phone: true },
      { label: t("committee.ageing.col.fees"), phone: true },
      { label: t("committee.ageing.col.total"), phone: false },
    ],
    rows: [...listedBuckets(ageing).map((b) => ({ key: b.bucket, header: bucketLabel(b.bucket), cells: cells(b) })), { key: "total", header: t("committee.ageing.total"), cells: cells(ageing.total), total: true }],
  };
}

/** The age group that holds exactly the month's "Still unpaid" of Billed and collected (the same bills), or null: it ties the Dues page to the Collections page (D175). */
export function reconcilingGroup(ageing: Ageing, money: MoneyLine | null): AgeBucket | null {
  if (money === null || ageing.total.bills === 0) return null;
  return ageing.buckets.find((b) => b.unpaidBillsPaise === money.outstandingPaise && b.bills === money.flatsOutstanding && b.bills > 0)?.bucket ?? null;
}

/** "The 1 to 30 days row holds October's unpaid bills (...) plus their late fees." for the expander, or null when no group holds exactly the month's unpaid bills. */
export function reconcileLine(ageing: Ageing, money: MoneyLine | null, period: string): string | null {
  const group = reconcilingGroup(ageing, money);
  return group === null ? null : t("committee.def.ageReconcile", { group: bucketLabel(group), month: monthName(period) });
}
