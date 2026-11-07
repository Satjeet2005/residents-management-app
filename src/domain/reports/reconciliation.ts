import { medianOf } from "./stats";

export type RowStates = { QUEUED: number; AUTO_MATCHED: number; AWAITING_APPROVAL: number; MANUALLY_MATCHED: number; IGNORED: number };

/** One import as the check needs it: the rows it read, the rows it stored, the rows the reader refused and the rows an earlier import already held (all read back from the database). */
export type ImportCounts = { rowsRead: number; stored: number; invalidRows: number; alreadyImported: number };

/** A manual decision on a row and when: the row was imported at `importedAt`, the decision was made at `decidedAt` (milliseconds). */
export type InterventionInput = { decision: "MANUAL" | "APPROVED" | "REJECTED" | "IGNORE"; importedAt: number; decidedAt: number };

export const INTERVENTIONS = ["MANUAL", "APPROVED", "REJECTED", "IGNORE"] as const;
export type InterventionType = (typeof INTERVENTIONS)[number];

/** Do an import's rows add up to the rows it read? (stored + already imported + refused = read: the check the import screens make, D81.) */
export const isAccounted = (i: ImportCounts): boolean => i.stored + i.alreadyImported + i.invalidRows === i.rowsRead;

export type ReconciliationLine = {
  /** Bank rows stored by the imports of the window. */
  rowsImported: number;
  postedAutomatically: number;
  postedByHand: number;
  /** Waiting for a person (QUEUED). */
  waitingForPerson: number;
  waitingForApproval: number;
  notMaintenance: number;
  imports: number;
  /** Imports whose rows did not all add up (a wrong count is shown, never hidden). */
  notAccounted: number;
  /** True when there is at least one import and every one is accounted for; null when there is no import (no data). */
  allAccounted: boolean | null;
  interventions: { type: InterventionType; count: number; medianMinutes: number | null }[];
};

const minutesBetween = (from: number, to: number): number => Math.max(0, Math.floor((to - from) / 60_000));

/**
 * The reconciliation line of a window (D5, D81): the rows by what became of them, whether every import in the window was accounted for, and the manual
 * interventions by type with the median whole minutes from import to decision (the lower middle value for an even count). The share posted automatically is
 * `postedAutomatically` out of `rowsImported`, taken by the caller with `percent` (no rows is "no data"). Counts only: nothing here names a person or a flat.
 */
export function reconciliationLine(input: { states: RowStates; imports: readonly ImportCounts[]; decisions: readonly InterventionInput[] }): ReconciliationLine {
  const { states } = input;
  const notAccounted = input.imports.filter((i) => !isAccounted(i)).length;
  return {
    rowsImported: states.QUEUED + states.AUTO_MATCHED + states.AWAITING_APPROVAL + states.MANUALLY_MATCHED + states.IGNORED,
    postedAutomatically: states.AUTO_MATCHED,
    postedByHand: states.MANUALLY_MATCHED,
    waitingForPerson: states.QUEUED,
    waitingForApproval: states.AWAITING_APPROVAL,
    notMaintenance: states.IGNORED,
    imports: input.imports.length,
    notAccounted,
    allAccounted: input.imports.length === 0 ? null : notAccounted === 0,
    interventions: INTERVENTIONS.map((type) => {
      const mine = input.decisions.filter((d) => d.decision === type);
      return { type, count: mine.length, medianMinutes: medianOf(mine.map((d) => minutesBetween(d.importedAt, d.decidedAt))) };
    }),
  };
}
