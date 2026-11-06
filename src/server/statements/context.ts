import { z } from "zod";
import type { FlatContext, KnownPayer, MatchSettings, OpenBill, PaymentOnBill } from "@/domain/matching/types";
import { istDateOf } from "@/domain/time/calendar";
import type { DbOrTx } from "@/server/auth/db";
import { calendarDateOf, parsePolicy } from "@/server/home/mapper";

export type LoadedMatchContext = {
  /** Every flat, with its current residents, known payers and open bills (oldest first). Bill keys are the bills' database ids. */
  flats: FlatContext[];
  settings: MatchSettings;
};

const thresholdSchema = z.number().int().positive();

/**
 * Builds what the statement processor needs from the database, in a constant number of queries (six, none per flat): the flats,
 * the residents whose membership is current on the business date, the known payers, every bill, every PAYMENT and REVERSAL
 * ledger entry, and the society settings. Joining them is done in memory with maps, so 2,400 flats cost the same six queries as 20.
 *
 * A bill is open when it was issued on or before `now`'s India date and the payments dated up to then that were not reversed
 * leave some of it unpaid (the matcher's own rule, docs/matching-design.md). The payments of an open bill are all its live
 * payments, including one dated later, because the matcher refuses to post before a later payment (LATER_PAYMENT).
 * A missing or invalid late_fee_policy or approval_threshold_paise setting throws: a rule for money is never guessed.
 * Reads only: call it with the transaction that will also write, so the facts and the postings share a lock.
 */
export async function loadMatchContext(db: DbOrTx, now: number): Promise<LoadedMatchContext> {
  const today = istDateOf(now);
  const day = new Date(`${today}T00:00:00.000Z`);
  const [flats, members, payers, bills, entries, settings] = await Promise.all([
    db.flat.findMany({ select: { id: true, code: true } }),
    db.flatMember.findMany({
      where: { startsOn: { lte: day }, OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
      select: { flatId: true, user: { select: { name: true } } },
    }),
    db.knownPayer.findMany({ select: { flatId: true, identifierType: true, identifierValue: true } }),
    db.bill.findMany({ select: { id: true, flatId: true, issuedOn: true, dueOn: true, amountPaise: true } }),
    db.ledgerEntry.findMany({
      where: { entryType: { in: ["PAYMENT", "REVERSAL"] } },
      select: { id: true, entryType: true, billId: true, effectiveDate: true, amountPaise: true, reversesEntryId: true },
    }),
    db.societySetting.findMany({ where: { key: { in: ["late_fee_policy", "approval_threshold_paise"] } }, select: { key: true, value: true } }),
  ]);

  const threshold = thresholdSchema.safeParse(settings.find((s) => s.key === "approval_threshold_paise")?.value);
  if (!threshold.success) throw new Error("The approval_threshold_paise setting is missing or not valid");
  const matchSettings: MatchSettings = { approvalThresholdPaise: BigInt(threshold.data), lateFeePolicy: parsePolicy(settings) };

  const reversed = new Set(entries.filter((e) => e.entryType === "REVERSAL" && e.reversesEntryId !== null).map((e) => e.reversesEntryId));
  const paymentsByBill = new Map<string, PaymentOnBill[]>();
  for (const entry of entries) {
    if (entry.entryType !== "PAYMENT" || entry.billId === null || reversed.has(entry.id)) continue;
    const list = paymentsByBill.get(entry.billId) ?? [];
    list.push({ date: calendarDateOf(entry.effectiveDate), amountPaise: entry.amountPaise });
    paymentsByBill.set(entry.billId, list);
  }

  const openBillsByFlat = new Map<string, OpenBill[]>();
  for (const bill of bills) {
    const payments = paymentsByBill.get(bill.id) ?? [];
    const paid = payments.reduce((sum, p) => (p.date <= today ? sum + p.amountPaise : sum), 0n);
    if (calendarDateOf(bill.issuedOn) > today || paid >= bill.amountPaise) continue;
    const list = openBillsByFlat.get(bill.flatId) ?? [];
    list.push({ billKey: bill.id, amountPaise: bill.amountPaise, dueOn: calendarDateOf(bill.dueOn), paymentsOnBill: payments });
    openBillsByFlat.set(bill.flatId, list);
  }
  const residentsByFlat = new Map<string, { name: string }[]>();
  for (const member of members) {
    const list = residentsByFlat.get(member.flatId) ?? [];
    list.push({ name: member.user.name });
    residentsByFlat.set(member.flatId, list);
  }
  const payersByFlat = new Map<string, KnownPayer[]>();
  for (const payer of payers) {
    const list = payersByFlat.get(payer.flatId) ?? [];
    list.push({ type: payer.identifierType, value: payer.identifierValue });
    payersByFlat.set(payer.flatId, list);
  }

  return {
    flats: flats.map((flat) => ({
      code: flat.code,
      residents: residentsByFlat.get(flat.id) ?? [],
      knownPayers: payersByFlat.get(flat.id) ?? [],
      openBills: openBillsByFlat.get(flat.id) ?? [],
    })),
    settings: matchSettings,
  };
}
