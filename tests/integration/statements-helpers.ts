import type { PaymentsFixture, Resident } from "./payments-fixture";

export const HEADER = "Txn Date,Narration,Credit,Debit";
export const csv = (...lines: string[]): string => `${[HEADER, ...lines].join("\n")}\n`;

let reference = 400_000_000_000;
/** A 12-digit UPI reference that has not been used in this run. */
export const nextReference = (): string => String(++reference);

const rupees = (paise: bigint): string => `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;

/** A credit row the way a bank writes a UPI payment: the flat code and the name are in the narration. */
export const upiRow = (resident: Resident, paise: bigint, date = "2026-10-27", ref = nextReference()): string => `${date},UPI/${ref}/${resident.flatCode} ${resident.name}/maintenance,${rupees(paise)},`;

/** What a flat that owes ₹6,370 due 10 Sep owes on 27 Oct: principal and ₹98 of late fee. */
export const DUE_ON_27_OCT = 646_800n;

export async function counts(fx: PaymentsFixture): Promise<Record<string, number>> {
  const [imports, rows, ledger, matches, queue, audit] = await Promise.all([
    fx.owner.statementImport.count(),
    fx.owner.bankRow.count(),
    fx.owner.ledgerEntry.count(),
    fx.owner.paymentMatch.count(),
    fx.owner.accountsQueueItem.count({ where: { itemType: "BANK_ROW" } }),
    fx.owner.auditLog.count({ where: { entityType: "statement_import" } }),
  ]);
  return { imports, rows, ledger, matches, queue, audit };
}

export const balanceOf = async (fx: PaymentsFixture, flatId: string): Promise<bigint> => {
  const rows = await fx.owner.ledgerEntry.findMany({ where: { flatId }, select: { direction: true, amountPaise: true } });
  return rows.reduce((sum, e) => (e.direction === "CHARGE" ? sum + e.amountPaise : sum - e.amountPaise), 0n);
};
