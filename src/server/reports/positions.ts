import { type DueBill, type DueEntry, positionsForFlat } from "@/domain/billing/dues";
import type { LateFeePolicy } from "@/domain/billing/late-fee";
import type { ReportPosition } from "@/domain/reports/positions";
import type { CalendarDate } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import { parsePolicy, toDueBill, toDueEntry } from "@/server/home/mapper";

/**
 * The position of EVERY bill of EVERY flat as of `asOf`, from the same `positionsForFlat` the Home, the payment lock and the statement import use (D107): three
 * SELECTs however many flats there are (the late fee policy, the bills with their flat's code, the bill-linked ledger entries), then the positions are built in
 * memory flat by flat. A bill issued after `asOf` is not in the list. Nothing here writes, and the app role needs no new privilege for it.
 */
export async function loadReportPositions(db: Db, asOf: CalendarDate): Promise<{ positions: ReportPosition[]; policy: LateFeePolicy }> {
  const [settings, bills, entries] = await Promise.all([
    db.societySetting.findMany({ where: { key: "late_fee_policy" }, select: { key: true, value: true } }),
    db.bill.findMany({ select: { id: true, flatId: true, period: true, issuedOn: true, dueOn: true, amountPaise: true, flat: { select: { code: true, tower: true } } } }),
    db.ledgerEntry.findMany({
      where: { billId: { not: null }, entryType: { in: ["PAYMENT", "REVERSAL", "LATE_FEE", "ADJUSTMENT"] } },
      select: { id: true, flatId: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true },
    }),
  ]);
  const policy = parsePolicy(settings);
  const billsByFlat = Map.groupBy(bills, (b) => b.flatId);
  const entriesByFlat = Map.groupBy(entries, (e) => e.flatId);
  const positions: ReportPosition[] = [];
  for (const [flatId, flatBills] of billsByFlat) {
    const { code: flatCode, tower } = flatBills[0].flat;
    const dueBills: DueBill[] = flatBills.map(toDueBill);
    const dueEntries: DueEntry[] = (entriesByFlat.get(flatId) ?? []).map(toDueEntry);
    for (const p of positionsForFlat({ bills: dueBills, entries: dueEntries, policy, asOf })) positions.push({ ...p, flatId, flatCode, tower });
  }
  return { positions, policy };
}
