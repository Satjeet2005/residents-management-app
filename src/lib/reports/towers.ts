import type { ChartTable } from "@/components/charts/chart-parts";
import { formatRupees } from "@/domain/money/money";
import type { TowerRollup, TowerRow } from "@/domain/reports/towers";
import { t } from "@/lib/messages";
import { countText } from "./cards";

/** How many towers are listed before "See all": the ten that owe the most. */
export const TOWERS_SHOWN = 10;

/** "Tower 12" for the code "T12", the code as it is for any other. */
export function towerName(code: string): string {
  const match = /^T0*(\d+)$/.exec(code);
  return match === null ? code : t("committee.towers.name", { n: match[1] });
}

export const flatsOwingText = (n: number): string => (n === 1 ? t("committee.towers.flatsOne") : t("committee.towers.flats", { n: countText(n) }));
export const over90Text = (n: number): string => (n === 0 ? t("committee.towers.over90None") : n === 1 ? t("committee.towers.over90One") : t("committee.towers.over90", { n: countText(n) }));

/** The numbers behind the towers list: every tower, then a total row that is the Total owed of the age groups, in exact rupees. */
export function towersTableOf(rollup: TowerRollup): ChartTable {
  const cells = (row: TowerRow | TowerRollup["total"]) => [countText(row.flats), formatRupees(row.unpaidBillsPaise), formatRupees(row.lateFeesPaise), formatRupees(row.amountDuePaise), countText(row.flatsOver90)];
  return {
    caption: t("committee.towers.caption"),
    columns: [t("committee.towers.col.tower"), t("committee.towers.col.flats"), t("committee.towers.col.unpaid"), t("committee.towers.col.fees"), t("committee.towers.col.total"), t("committee.towers.col.over90")],
    rows: [...rollup.towers.map((row) => ({ header: towerName(row.tower), cells: cells(row) })), { header: t("committee.ageing.total"), cells: cells(rollup.total) }],
  };
}
