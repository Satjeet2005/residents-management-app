import type { Paise } from "../money/money";
import { type CalendarDate } from "../time/calendar";
import { OVER_90_FROM_DAYS, daysPastDue } from "./age";
import { type ReportPosition, isOpen } from "./positions";

/** What the flats of one tower owe: the flats with something open, the unpaid bills and late fees apart (their sum is the amount due), and the flats with a bill over 90 days. */
export type TowerRow = { tower: string; flats: number; bills: number; unpaidBillsPaise: Paise; lateFeesPaise: Paise; amountDuePaise: Paise; flatsOver90: number };

/** The towers by what they owe, the most first, and the totals over ALL of them (D182). */
export type TowerRollup = { towers: TowerRow[]; total: { flats: number; bills: number; unpaidBillsPaise: Paise; lateFeesPaise: Paise; amountDuePaise: Paise; flatsOver90: number } };

/**
 * The roll-up of what is owed by TOWER, from the same open positions as the age groups (so it adds up to Total owed exactly): per tower, the flats that owe
 * something (each once), the bills, the unpaid bills, the late fees and the flats with a bill more than 90 days past its due date. Ordered by amount due, the most
 * first, then by tower name, so the order is the same on every read. Only the tower name and counts: no flat code, no name.
 */
export function towerRollup(positions: readonly ReportPosition[], asOf: CalendarDate): TowerRollup {
  const open = positions.filter(isOpen);
  const sum = (own: readonly ReportPosition[], pick: (p: ReportPosition) => Paise): Paise => own.reduce((total, p) => total + pick(p), 0n);
  const figures = (own: readonly ReportPosition[]) => {
    const unpaidBillsPaise = sum(own, (p) => p.position.principalOutstandingPaise);
    const lateFeesPaise = sum(own, (p) => p.position.feeOutstandingPaise);
    return {
      flats: new Set(own.map((p) => p.flatId)).size,
      bills: own.length,
      unpaidBillsPaise,
      lateFeesPaise,
      amountDuePaise: unpaidBillsPaise + lateFeesPaise,
      flatsOver90: new Set(own.filter((p) => daysPastDue(p.bill.dueOn, asOf) >= OVER_90_FROM_DAYS).map((p) => p.flatId)).size,
    };
  };
  const towers = [...Map.groupBy(open, (p) => p.tower)]
    .map(([tower, own]): TowerRow => ({ tower, ...figures(own) }))
    .sort((a, b) => (a.amountDuePaise === b.amountDuePaise ? (a.tower < b.tower ? -1 : a.tower > b.tower ? 1 : 0) : a.amountDuePaise < b.amountDuePaise ? 1 : -1));
  return { towers, total: figures(open) };
}
