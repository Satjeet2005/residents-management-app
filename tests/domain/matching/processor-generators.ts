import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import type { RowError, StatementRow } from "@/domain/matching/csv";
import type { ProcessInput } from "@/domain/matching/processor";
import { defaultMatchSettings } from "@/domain/matching/context";
import type { FlatContext } from "@/domain/matching/types";
import type { Prng } from "@/domain/seed/prng";

/** What a flat's oldest unpaid bill needs on a date, worked out straight from computeLateFee. */
export function dueOf(flat: FlatContext, asOf: string): { due: bigint; principal: bigint } | null {
  for (const bill of [...flat.openBills].sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0))) {
    const result = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf, payments: bill.paymentsOnBill.filter((p) => p.date <= asOf), holds: [], policy: defaultLateFeePolicy });
    if (result.outstandingPaise > 0n) return { due: result.outstandingPaise + result.feePaise, principal: result.outstandingPaise };
  }
  return null;
}

export type GenerateOptions = {
  /** Repeat the previous row now and then (the same reference, so the same payment). */
  duplicates?: boolean;
  /** Added to every reference number, so two files can have different payments. */
  referenceBase?: number;
};

export const row = (rowNumber: number, txnDate: string, narrationRaw: string, creditPaise: bigint, debitPaise = 0n): StatementRow => ({
  rowNumber,
  txnDate,
  valueDate: null,
  narrationRaw,
  creditPaise,
  debitPaise,
  balancePaise: null,
  reference: null,
});

/** A statement of `count` rows over October 2026, drawn from `flats`: codes, payers, names, cash, debits, noise, repeats. */
export function randomRows(rng: Prng, flats: readonly FlatContext[], count: number, options: GenerateOptions = {}): StatementRow[] {
  const withBills = flats.filter((f) => f.openBills.length > 0);
  const pool = (list: readonly FlatContext[]): FlatContext => rng.pick(list.length > 0 ? list : flats);
  const rows: StatementRow[] = [];
  for (let i = 0; i < count; i++) {
    const date = `2026-10-${String(rng.int(1, 27)).padStart(2, "0")}`;
    const ref = String(402_200_000_000 + (options.referenceBase ?? 0) + i);
    const n = i + 1;
    const flat = pool(withBills);
    const owed = dueOf(flat, date);
    const credit = owed === null ? BigInt(rng.int(100, 20_000)) * 100n : owed.due;
    const kind = rng.int(0, 9);
    if (kind <= 2) rows.push(row(n, date, `UPI/${ref}/${flat.code}/maint`, credit));
    else if (kind === 3) {
      const payer = pool(withBills.filter((f) => f.knownPayers.some((p) => p.type === "UPI_ID")));
      const upi = payer.knownPayers.find((p) => p.type === "UPI_ID")?.value ?? "nobody@demo";
      const owedByPayer = dueOf(payer, date);
      rows.push(row(n, date, `UPI/${ref}/${upi}/maint`, owedByPayer === null ? credit : owedByPayer.due));
    } else if (kind === 4) rows.push(row(n, date, `NEFT-N30${ref}-${(flat.residents[0]?.name ?? "NOBODY HERE").toUpperCase()}-maint`, credit));
    else if (kind === 5) rows.push(row(n, date, `CASH DEP SLIP ${ref}`, BigInt(rng.int(100, 20_000)) * 100n));
    else if (kind === 6) rows.push(row(n, date, `ATM WDL ${ref}`, 0n, BigInt(rng.int(100, 20_000)) * 100n));
    else if (kind === 7 && options.duplicates === true && rows.length > 0) rows.push({ ...rows[rows.length - 1], rowNumber: n });
    else if (kind === 8) rows.push(row(n, date, `UPI/${ref}/${flat.code}/maint`, owed === null ? credit : owed.principal));
    else rows.push(row(n, date, `UPI/${ref}/stranger@zzz`, credit));
  }
  return rows;
}

export function inputFor(rows: readonly StatementRow[], flats: readonly FlatContext[], extra: Partial<ProcessInput> = {}): ProcessInput {
  const csvErrors: RowError[] = [];
  return { rows, csvErrors, flats, settings: defaultMatchSettings, alreadyImportedKeys: new Set(), ...extra };
}

/** The demo flats split once into those with open bills and those without, so a sample costs little. */
export function samplePools(flats: readonly FlatContext[]): { withBills: FlatContext[]; without: FlatContext[] } {
  return { withBills: flats.filter((f) => f.openBills.length > 0), without: flats.filter((f) => f.openBills.length === 0) };
}

/** A random sample of `count` flats, half of them with open bills. */
export function sampleFlats(rng: Prng, pools: { withBills: readonly FlatContext[]; without: readonly FlatContext[] }, count: number): FlatContext[] {
  const pick = (list: readonly FlatContext[]): FlatContext[] => Array.from({ length: count / 2 }, () => rng.pick(list));
  return [...new Map([...pick(pools.withBills), ...pick(pools.without)].map((f) => [f.code, f])).values()];
}

/** Freezes a value and everything inside it, so any change throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
