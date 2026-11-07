import { type ReconciliationLine, type RowStates, reconciliationLine } from "@/domain/reports/reconciliation";
import { type CalendarDate, addDays, dayStartInstant } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";

/** The window of the reconciliation line: the 30 India days that end on the business date. */
export const RECONCILIATION_DAYS = 30;

/**
 * The reconciliation line of the last 30 days to the business date (D5): the bank rows of the imports uploaded in the window (on or after its first day) by what became of them, whether
 * every import's rows add up (read back from the database for each import, as the import screens do), and the manual interventions with the time from import to
 * decision. THREE queries however many imports there are: the imports, the rows grouped by import and state, and the manual decisions. Reads only.
 */
export async function loadReconciliationLine(db: Db, asOf: CalendarDate): Promise<ReconciliationLine> {
  // No upper bound: on a live clock the business date is today, so nothing is newer; under a frozen demo date (DEMO_AS_OF) an import made later in real time still counts.
  const uploaded = { gte: new Date(dayStartInstant(addDays(asOf, 1 - RECONCILIATION_DAYS))) };
  const [imports, grouped, decisions] = await Promise.all([
    db.statementImport.findMany({ where: { uploadedAt: uploaded }, select: { id: true, rowsRead: true, notes: true } }),
    db.bankRow.groupBy({ by: ["importId", "state"], where: { import: { uploadedAt: uploaded } }, _count: { _all: true } }),
    db.paymentMatch.findMany({
      where: { decision: { in: ["MANUAL", "APPROVED", "REJECTED", "IGNORE"] }, bankRow: { import: { uploadedAt: uploaded } } },
      select: { decision: true, decidedAt: true, bankRow: { select: { createdAt: true } } },
    }),
  ]);
  const states: RowStates = { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 };
  const storedByImport = new Map<string, number>();
  for (const g of grouped) {
    states[g.state] += g._count._all;
    storedByImport.set(g.importId, (storedByImport.get(g.importId) ?? 0) + g._count._all);
  }
  return reconciliationLine({
    states,
    imports: imports.map((i) => {
      const notes = JSON.parse(i.notes ?? "{}") as { invalidRows?: number; alreadyImported?: number };
      return { rowsRead: i.rowsRead, stored: storedByImport.get(i.id) ?? 0, invalidRows: notes.invalidRows ?? 0, alreadyImported: notes.alreadyImported ?? 0 };
    }),
    decisions: decisions.flatMap((d) => (d.decision === "MANUAL" || d.decision === "APPROVED" || d.decision === "REJECTED" || d.decision === "IGNORE" ? [{ decision: d.decision, importedAt: d.bankRow.createdAt.getTime(), decidedAt: d.decidedAt.getTime() }] : [])),
  });
}
