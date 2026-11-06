import { type FlatBillPosition, positionsForFlat } from "@/domain/billing/dues";
import type { LateFeePolicy } from "@/domain/billing/late-fee";
import type { CalendarDate } from "@/domain/time/calendar";
import type { DbOrTx } from "@/server/auth/db";
import { parsePolicy, toDueBill, toDueEntry } from "@/server/home/mapper";

/** An open position of a flat as a person reads it: money as decimal strings, so the answer is JSON as it stands. */
export type OpenPositionView = {
  billId: string;
  kind: "PRINCIPAL_OPEN" | "FEE_ONLY";
  dueOn: CalendarDate;
  principalOutstandingPaise: string;
  feePaise: string;
  amountDuePaise: string;
};

/** How a credit compares with the oldest open position of a flat. */
export type AmountRelation = "EQUALS_DUE" | "EQUALS_PRINCIPAL" | "LESS_THAN_DUE" | "MORE_THAN_DUE" | "NO_OPEN_POSITION";

export async function loadPolicy(db: DbOrTx): Promise<LateFeePolicy> {
  return parsePolicy(await db.societySetting.findMany({ where: { key: "late_fee_policy" }, select: { key: true, value: true } }));
}

/**
 * The positions of every bill of the given flats as of `asOf`, oldest due date first, from the same `positionsForFlat` the Home
 * and the payment lock use (D107). Four queries however many flats there are. Reads only.
 */
export async function loadPositions(db: DbOrTx, flatIds: readonly string[], asOf: CalendarDate, policy: LateFeePolicy): Promise<Map<string, FlatBillPosition[]>> {
  const result = new Map<string, FlatBillPosition[]>(flatIds.map((id) => [id, []]));
  if (flatIds.length === 0) return result;
  const [bills, entries] = await Promise.all([
    db.bill.findMany({ where: { flatId: { in: [...flatIds] } }, select: { id: true, flatId: true, period: true, issuedOn: true, dueOn: true, amountPaise: true } }),
    db.ledgerEntry.findMany({
      where: { flatId: { in: [...flatIds] }, entryType: { in: ["PAYMENT", "REVERSAL", "LATE_FEE", "ADJUSTMENT"] } },
      select: { id: true, flatId: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true },
    }),
  ]);
  const billsByFlat = Map.groupBy(bills, (b) => b.flatId);
  const entriesByFlat = Map.groupBy(entries, (e) => e.flatId);
  for (const flatId of flatIds) {
    result.set(
      flatId,
      positionsForFlat({ bills: (billsByFlat.get(flatId) ?? []).map(toDueBill), entries: (entriesByFlat.get(flatId) ?? []).map(toDueEntry), policy, asOf }),
    );
  }
  return result;
}

export const openOnly = (positions: readonly FlatBillPosition[]): FlatBillPosition[] => positions.filter((p) => p.position.kind !== "SETTLED");

export function viewOf(open: FlatBillPosition): OpenPositionView {
  const { position, bill } = open;
  return {
    billId: bill.id,
    kind: position.kind === "FEE_ONLY" ? "FEE_ONLY" : "PRINCIPAL_OPEN",
    dueOn: bill.dueOn,
    principalOutstandingPaise: position.principalOutstandingPaise.toString(),
    feePaise: position.feeOutstandingPaise.toString(),
    amountDuePaise: position.amountDuePaise.toString(),
  };
}

export function relationOf(credit: bigint, oldest: FlatBillPosition | undefined): AmountRelation {
  if (oldest === undefined) return "NO_OPEN_POSITION";
  const { position } = oldest;
  if (credit === position.amountDuePaise) return "EQUALS_DUE";
  if (position.kind === "PRINCIPAL_OPEN" && credit === position.principalOutstandingPaise) return "EQUALS_PRINCIPAL";
  return credit < position.amountDuePaise ? "LESS_THAN_DUE" : "MORE_THAN_DUE";
}
