import type { ProcessedRow, ProcessedStatement } from "../processor";
import type { Candidate } from "../types";
import type { TruthKind, TruthRow } from "./truth";

/**
 * Everything here is computed from the truth the simulator wrote down, never from the matcher's own opinion.
 *
 * - FALSE AUTO-POST: an AUTO_MATCHED row whose flat is not the truth's flat, or whose bill is not the truth's bill,
 *   or whose truth is not PAYS_BILL at all. Auto-posting a MULTI_BILL, ADVANCE, PARTIAL, NOT_MAINTENANCE, RETURN
 *   or AMBIGUOUS_INTENT payment is a false auto-post too.
 * - TRUE AUTO-POST: an AUTO_MATCHED row that matches the truth exactly: PAYS_BILL, the same flat, the same bill.
 * - MATCHABLE: rows whose truth is PAYS_BILL for a flat, the ones the matcher could legitimately auto-post.
 * - precision of auto = trueAuto / (trueAuto + falseAuto), 1 when there are none.
 * - recall of auto = trueAuto / matchable, 1 when there is nothing matchable.
 * - autoRate = autoMatched / creditRows. queueRate = queued credit rows / creditRows.
 * - top1 and top5: of the QUEUED rows whose truth is PAYS_BILL, the share whose top candidate (top1) or whose
 *   first five candidates (top5) include the true flat; 1 when there are no such rows.
 * - wrongIgnores: IGNORED rows whose truth is not NOT_MAINTENANCE (money wrongly ignored).
 * - notMaintenanceNotIgnored: rows whose truth is NOT_MAINTENANCE that were queued or auto-matched (work for a person, or worse).
 * - accounted: from the processor.
 */
export type FalseAuto = {
  rowNumber: number;
  narration: string;
  truthKind: TruthKind;
  truthFlat: string | null;
  decidedFlat: string | null;
  reasons: string[];
};

export type Confusion = { truth: TruthKind; decision: string; count: number };

export type Metrics = {
  rows: number;
  credits: number;
  autoMatched: number;
  queued: number;
  ignored: number;
  alreadyImported: number;
  trueAuto: number;
  falseAuto: number;
  matchable: number;
  precision: number;
  recall: number;
  autoRate: number;
  queueRate: number;
  top1: number;
  top5: number;
  wrongIgnores: number;
  notMaintenanceNotIgnored: number;
  accounted: boolean;
  /** Counts of QUEUE reason codes: each code once per queued row. */
  queueReasons: Record<string, number>;
  /** The ten most frequent (truth, decision) pairs that are not the ideal outcome, most frequent first. */
  confusions: Confusion[];
  falseAutoRows: FalseAuto[];
};

const ratio = (n: number, d: number): number => (d === 0 ? 1 : n / d);

/** The decision as a short label: the state, and for a queue the confidence. */
function decisionLabel(row: ProcessedRow): string {
  if (row.state === "QUEUED" && row.decision !== null) return `QUEUED/${row.decision.confidence}`;
  return row.state;
}

/** True for the outcomes that are right and need no attention, so they are not "confusions". */
function isIdeal(kind: TruthKind, label: string, trueAuto: boolean): boolean {
  return trueAuto || (kind === "NOT_MAINTENANCE" && label === "IGNORED") || (kind === "RETURN" && label.startsWith("QUEUED"));
}

/**
 * Scores one processed statement against its truth. Throws when a processed row has no truth entry (a row number
 * the truth does not list), since a number computed over a partial truth would be wrong.
 */
export function evaluate(processed: ProcessedStatement, truth: readonly TruthRow[], narrations: ReadonlyMap<number, string> = new Map()): Metrics {
  const truthOf = new Map(truth.map((t) => [t.rowNumber, t.truth]));
  const queueReasons: Record<string, number> = {};
  const confusionCounts = new Map<string, Confusion>();
  const falseAutoRows: FalseAuto[] = [];
  let trueAuto = 0;
  let matchable = 0;
  let queuedBill = 0;
  let top1 = 0;
  let top5 = 0;
  let wrongIgnores = 0;
  let notMaintenanceNotIgnored = 0;
  let credits = 0;
  let queuedCredits = 0;

  for (const row of processed.rows) {
    const t = truthOf.get(row.rowNumber);
    if (t === undefined) throw new RangeError(`Row ${row.rowNumber} has no truth`);
    if (row.creditPaise > 0n) credits++;
    if (t.kind === "PAYS_BILL" && t.flatCode !== null) matchable++;
    if (row.state === "ALREADY_IMPORTED") continue;

    const decision = row.decision;
    const label = decisionLabel(row);
    let wasTrueAuto = false;
    if (row.state === "AUTO_MATCHED" && decision !== null) {
      const billKey = decision.plan?.entries[0]?.billKey ?? null;
      if (t.kind === "PAYS_BILL" && t.flatCode === decision.flatCode && billKey === t.billKeys[0]) {
        trueAuto++;
        wasTrueAuto = true;
      } else {
        falseAutoRows.push({
          rowNumber: row.rowNumber,
          narration: narrations.get(row.rowNumber) ?? "",
          truthKind: t.kind,
          truthFlat: t.flatCode,
          decidedFlat: decision.flatCode,
          reasons: decision.reasons.map((r) => r.code),
        });
      }
    }
    if (row.state === "QUEUED" && decision !== null) {
      if (row.creditPaise > 0n) queuedCredits++;
      for (const code of new Set(decision.reasons.map((r) => r.code))) queueReasons[code] = (queueReasons[code] ?? 0) + 1;
      if (t.kind === "PAYS_BILL" && t.flatCode !== null) {
        queuedBill++;
        const candidates: Candidate[] = decision.candidates;
        if (candidates[0]?.flatCode === t.flatCode) top1++;
        if (candidates.slice(0, 5).some((c) => c.flatCode === t.flatCode)) top5++;
      }
    }
    if (row.state === "IGNORED" && t.kind !== "NOT_MAINTENANCE") wrongIgnores++;
    if (t.kind === "NOT_MAINTENANCE" && (row.state === "QUEUED" || row.state === "AUTO_MATCHED")) notMaintenanceNotIgnored++;
    if (!isIdeal(t.kind, label, wasTrueAuto)) {
      const key = `${t.kind} ${label}`;
      const kept = confusionCounts.get(key) ?? { truth: t.kind, decision: label, count: 0 };
      kept.count++;
      confusionCounts.set(key, kept);
    }
  }
  const { summary } = processed;
  const falseAuto = falseAutoRows.length;
  return {
    rows: summary.validRows,
    credits,
    autoMatched: summary.autoMatched,
    queued: summary.queued,
    ignored: summary.ignored,
    alreadyImported: summary.alreadyImported,
    trueAuto,
    falseAuto,
    matchable,
    precision: ratio(trueAuto, trueAuto + falseAuto),
    recall: ratio(trueAuto, matchable),
    autoRate: ratio(summary.autoMatched, credits),
    queueRate: ratio(queuedCredits, credits),
    top1: ratio(top1, queuedBill),
    top5: ratio(top5, queuedBill),
    wrongIgnores,
    notMaintenanceNotIgnored,
    accounted: processed.accounted,
    queueReasons: Object.fromEntries(Object.entries(queueReasons).sort(([a], [b]) => (a < b ? -1 : 1))),
    confusions: [...confusionCounts.values()].sort((a, b) => b.count - a.count || (a.truth + a.decision < b.truth + b.decision ? -1 : 1)).slice(0, 10),
    falseAutoRows,
  };
}
