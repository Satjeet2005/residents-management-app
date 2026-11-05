import type { Paise } from "../money/money";
import { buildMatchContext } from "./context";
import type { RowError, StatementRow } from "./csv";
import { matchRow } from "./decide";
import { rowDedupeKey } from "./dedupe";
import { parseNarration, type ParsedNarration } from "./narration";
import type { FlatContext, MatchSettings, PostingEntry, RowDecision } from "./types";

/** A valid row from the CSV reader. */
export type ImportRow = StatementRow;

export type ProcessInput = {
  rows: readonly ImportRow[];
  /** What the CSV reader refused. These rows are counted and reported, never dropped. */
  csvErrors: readonly RowError[];
  flats: readonly FlatContext[];
  settings: MatchSettings;
  /** Dedupe keys of rows that an earlier import already took in. */
  alreadyImportedKeys: ReadonlySet<string>;
};

export type RowState = "AUTO_MATCHED" | "QUEUED" | "IGNORED" | "ALREADY_IMPORTED";

export type ProcessedRow = {
  rowNumber: number;
  dedupeKey: string;
  parsed: ParsedNarration;
  state: RowState;
  /** Null only for ALREADY_IMPORTED: such a row is not looked at again. */
  decision: RowDecision | null;
};

/** One ledger entry to write for an automatically matched row. */
export type PlannedEntry = PostingEntry & {
  rowNumber: number;
  flatCode: string;
  /** Unique per row and entry type, so writing it twice cannot post twice. */
  idempotencyKey: string;
};

export type Summary = {
  /** Valid rows plus invalid rows. */
  rowsRead: number;
  validRows: number;
  /** Rows the CSV reader refused: distinct row numbers among the errors (0 is the header). */
  invalidRows: number;
  autoMatched: number;
  queued: number;
  ignored: number;
  alreadyImported: number;
  /** The sum of the credits of all valid rows. */
  creditTotalPaise: Paise;
  /** The sum of the credits of the AUTO_MATCHED rows. */
  autoMatchedTotalPaise: Paise;
};

export type ProcessedStatement = {
  /** In processing order: by transaction date, then row number. */
  rows: ProcessedRow[];
  csvErrors: RowError[];
  summary: Summary;
  /** The LATE_FEE and PAYMENT entries of the AUTO_MATCHED rows, in row order. */
  entriesToPost: PlannedEntry[];
};

/** Date, then row number: the order is the same whatever order the rows arrive in. */
const byDateThenRow = (a: ImportRow, b: ImportRow): number =>
  a.txnDate === b.txnDate ? a.rowNumber - b.rowNumber : a.txnDate < b.txnDate ? -1 : 1;

const STATE_OF: Readonly<Record<RowDecision["kind"], RowState>> = { AUTO_MATCH: "AUTO_MATCHED", QUEUE: "QUEUED", IGNORE: "IGNORED" };

function plannedEntries(row: ProcessedRow, flatCode: string, decision: RowDecision): PlannedEntry[] {
  return (decision.plan?.entries ?? []).map((entry) => ({
    ...entry,
    rowNumber: row.rowNumber,
    flatCode,
    idempotencyKey: `bank:${row.dedupeKey}:${entry.entryType}`,
  }));
}

function summarise(rows: readonly ProcessedRow[], credits: ReadonlyMap<number, Paise>, csvErrors: readonly RowError[]): Summary {
  const count = (state: RowState): number => rows.filter((r) => r.state === state).length;
  const invalidRows = new Set(csvErrors.map((e) => e.rowNumber)).size;
  const sum = (selected: readonly ProcessedRow[]): Paise => selected.reduce((total, r) => total + (credits.get(r.rowNumber) ?? 0n), 0n);
  return {
    rowsRead: rows.length + invalidRows,
    validRows: rows.length,
    invalidRows,
    autoMatched: count("AUTO_MATCHED"),
    queued: count("QUEUED"),
    ignored: count("IGNORED"),
    alreadyImported: count("ALREADY_IMPORTED"),
    creditTotalPaise: sum(rows),
    autoMatchedTotalPaise: sum(rows.filter((r) => r.state === "AUTO_MATCHED")),
  };
}

/**
 * Takes in a whole statement: orders the rows, skips the ones an earlier import already took,
 * decides each of the others with matchRow, and lists the ledger entries to write for the
 * automatic matches. It reads and writes nothing outside its arguments and never changes them.
 * Throws RangeError for a bad flat list, bad settings or a negative amount.
 */
export function processStatement(input: ProcessInput): ProcessedStatement {
  const context = buildMatchContext(input.flats, input.settings);
  const ordered = [...input.rows].sort(byDateThenRow);
  const occurrences = new Map<string, number>();
  const taken = new Set<string>(input.alreadyImportedKeys);
  const credits = new Map<number, Paise>();
  const rows: ProcessedRow[] = [];
  const entriesToPost: PlannedEntry[] = [];

  for (const row of ordered) {
    const parsed = parseNarration(row.narrationRaw);
    const base = rowDedupeKey(row, parsed, 1);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const dedupeKey = occurrence === 1 ? base : rowDedupeKey(row, parsed, occurrence);
    credits.set(row.rowNumber, row.creditPaise);

    if (taken.has(dedupeKey)) {
      rows.push({ rowNumber: row.rowNumber, dedupeKey, parsed, state: "ALREADY_IMPORTED", decision: null });
      continue;
    }
    taken.add(dedupeKey);
    const decision = matchRow(context, row, parsed);
    const processed: ProcessedRow = { rowNumber: row.rowNumber, dedupeKey, parsed, state: STATE_OF[decision.kind], decision };
    rows.push(processed);
    if (decision.kind === "AUTO_MATCH" && decision.flatCode !== null) entriesToPost.push(...plannedEntries(processed, decision.flatCode, decision));
  }
  return { rows, csvErrors: input.csvErrors.map((e) => ({ ...e })), summary: summarise(rows, credits, input.csvErrors), entriesToPost };
}
