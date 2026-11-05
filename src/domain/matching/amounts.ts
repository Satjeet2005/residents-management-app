import { computeLateFee, type LateFeePolicy, type LateFeeResult } from "../billing/late-fee";
import type { Paise } from "../money/money";
import type { CalendarDate } from "../time/calendar";
import type { AmountIndex, AmountRelation, MatchContext, OldestDue, OpenBill } from "./types";

/** Bills oldest due date first, then by bill key. The input is not changed. */
export function sortedByDue(bills: readonly OpenBill[]): OpenBill[] {
  return [...bills].sort((a, b) => (a.dueOn === b.dueOn ? (a.billKey < b.billKey ? -1 : a.billKey > b.billKey ? 1 : 0) : a.dueOn < b.dueOn ? -1 : 1));
}

function feeKey(bill: OpenBill, payments: readonly { date: string; amountPaise: Paise }[], asOf: CalendarDate): string {
  const paid = payments.map((p) => `${p.date}:${p.amountPaise}`).sort().join(",");
  return `${bill.amountPaise}|${bill.dueOn}|${asOf}|${paid}`;
}

/**
 * The late fee on one bill as of a date, using the real computeLateFee with no holds.
 * Only payments dated on or before the date count. Results are kept in `cache` when one is given;
 * two bills with the same amount, due date and payments share an entry.
 */
export function lateFeeOn(bill: OpenBill, asOf: CalendarDate, policy: LateFeePolicy, cache?: Map<string, LateFeeResult>): LateFeeResult {
  const payments = bill.paymentsOnBill.filter((p) => p.date <= asOf);
  const key = cache === undefined ? "" : feeKey(bill, payments, asOf);
  const hit = cache?.get(key);
  if (hit !== undefined) return hit;
  const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf, payments, holds: [], policy });
  cache?.set(key, result);
  return result;
}

/**
 * The oldest bill that still has principal unpaid on `asOf`, with its fee and the amount due
 * (outstanding principal plus fee). A bill that payments dated by `asOf` already cover is skipped.
 * Null when the flat has no such bill. Bills must be oldest first.
 */
export function oldestDue(bills: readonly OpenBill[], asOf: CalendarDate, policy: LateFeePolicy, cache?: Map<string, LateFeeResult>): OldestDue | null {
  for (const bill of bills) {
    const result = lateFeeOn(bill, asOf, policy, cache);
    if (result.outstandingPaise > 0n) {
      return {
        billKey: bill.billKey,
        billAmountPaise: bill.amountPaise,
        outstandingPaise: result.outstandingPaise,
        feePaise: result.feePaise,
        duePaise: result.outstandingPaise + result.feePaise,
      };
    }
  }
  return null;
}

/** How a credit compares with the oldest open bill. The checks run in this order. */
export function amountRelation(creditPaise: Paise, bills: readonly OpenBill[], due: OldestDue | null): AmountRelation {
  if (due === null) return "NO_OPEN_BILL";
  if (creditPaise === due.duePaise) return "EQUALS_DUE";
  if (creditPaise === due.outstandingPaise) return "EQUALS_PRINCIPAL";
  if (bills.some((bill) => bill.amountPaise === creditPaise)) return "EQUALS_BILL";
  return creditPaise < due.duePaise ? "LESS_THAN_DUE" : "MORE_THAN_DUE";
}

function addTo(map: Map<Paise, string[]>, amount: Paise, code: string): void {
  const list = map.get(amount);
  if (list === undefined) map.set(amount, [code]);
  else list.push(code);
}

/**
 * For one date: which flats have an oldest open bill whose amount due, or whose outstanding principal,
 * is a given amount. Built on first use for that date and kept in the context.
 */
export function amountIndexFor(context: MatchContext, asOf: CalendarDate): AmountIndex {
  const kept = context.caches.amounts.get(asOf);
  if (kept !== undefined) return kept;
  const index: AmountIndex = { byDue: new Map(), byPrincipal: new Map() };
  for (const flat of context.flats) {
    if (flat.openBills.length === 0) continue;
    const due = oldestDue(flat.openBills, asOf, context.settings.lateFeePolicy, context.caches.fees);
    if (due === null) continue;
    addTo(index.byDue, due.duePaise, flat.code);
    addTo(index.byPrincipal, due.outstandingPaise, flat.code);
  }
  context.caches.amounts.set(asOf, index);
  return index;
}
