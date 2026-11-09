import type { DataColumn, DataRow } from "@/components/committee/data-table";
import { formatRupees } from "@/domain/money/money";
import type { TowerRollup, TowerRow } from "@/domain/reports/towers";
import { t } from "@/lib/messages";
import { countText } from "./cards";

/** How many towers the Dues page lists: the five that owe the most (the rest are on the towers page). */
export const TOWERS_SHOWN = 5;

/** "Tower 12" for the code "T12", the code as it is for any other. */
export function towerName(code: string): string {
  const match = /^T0*(\d+)$/.exec(code);
  return match === null ? code : t("committee.towers.name", { n: match[1] });
}

/**
 * A table of towers: Tower, Owed, Flats owing, Over 90 days on a phone, and from 768px also Unpaid bills and Late fees. `full` adds the two wide columns and the totals
 * row, whose Owed is Total owed (a tested invariant); the short table of the Dues page has neither.
 */
export function towersTable(rollup: { towers: readonly TowerRow[]; total: TowerRollup["total"] }, full: boolean): { caption: string; columns: DataColumn[]; rows: DataRow[] } {
  const narrow = (row: TowerRow | TowerRollup["total"]) => [formatRupees(row.amountDuePaise), countText(row.flats), countText(row.flatsOver90)];
  const wide = (row: TowerRow | TowerRollup["total"]) => [formatRupees(row.amountDuePaise), countText(row.flats), countText(row.flatsOver90), formatRupees(row.unpaidBillsPaise), formatRupees(row.lateFeesPaise)];
  const cells = full ? wide : narrow;
  return {
    caption: t("committee.towers.caption"),
    columns: [
      { label: t("committee.towers.col.tower"), phone: true },
      { label: t("committee.towers.col.owed"), phone: true },
      { label: t("committee.towers.col.flats"), phone: true },
      { label: t("committee.towers.col.over90"), phone: true },
      ...(full ? [{ label: t("committee.towers.col.unpaid"), phone: false }, { label: t("committee.towers.col.fees"), phone: false }] : []),
    ],
    rows: [
      ...rollup.towers.map((row) => ({ key: row.tower, header: towerName(row.tower), cells: cells(row) })),
      ...(full ? [{ key: "total", header: t("committee.ageing.total"), cells: wide(rollup.total), total: true }] : []),
    ],
  };
}

/** The towers in the order asked for: "owed" is the order of the roll-up (the most owed first, ties by name); "tower" is by tower name. */
export function sortTowers(towers: readonly TowerRow[], sort: "owed" | "tower"): TowerRow[] {
  return sort === "owed" ? [...towers] : [...towers].sort((a, b) => (a.tower < b.tower ? -1 : a.tower > b.tower ? 1 : 0));
}

/** The order named by `?sort=`: "tower" is by tower name; anything else, or nothing, is the default, the most owed first. */
export const towerSortFromQuery = (value: string | string[] | undefined): "owed" | "tower" => ((Array.isArray(value) ? value[0] : value) === "tower" ? "tower" : "owed");

/** The address of the towers page in the order asked for (the default, the most owed first, is left out). */
export const towersHref = (sort: "owed" | "tower"): string => `/staff/reports/dues/towers${sort === "tower" ? "?sort=tower" : ""}`;
