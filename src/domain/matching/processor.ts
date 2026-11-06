import type { Paise } from "../money/money";
import { recordPayment } from "./amounts";
import { buildMatchContext } from "./context";
import type { RowError, StatementRow } from "./csv";
import { matchRow } from "./decide";
import { byDateThenRow, computeRowKeys } from "./dedupe";
import { parseNarration, type ParsedNarration } from "./narration";
import type { FlatContext, MatchSettings, PostingEntry, Reason, RowDecision } from "./types";

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
  creditPaise: Paise;
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
  /** True only when accountingReport finds nothing wrong. It is worked out from the data, not assumed. */
  accounted: boolean;
  /** The LATE_FEE and PAYMENT entries of the AUTO_MATCHED rows, in row order. */
  entriesToPost: PlannedEntry[];
};

const STATE_OF: Readonly<Record<RowDecision["kind"], RowState>> = { AUTO_MATCH: "AUTO_MATCHED", QUEUE: "QUEUED", IGNORE: "IGNORED" };

function plannedEntries(row: ProcessedRow, flatCode: string, decision: RowDecision): PlannedEntry[] {
  return (decision.plan?.entries ?? []).map((entry) => ({
    ...entry,
    rowNumber: row.rowNumber,
    flatCode,
    idempotencyKey: `bank:${row.dedupeKey}:${entry.entryType}`,
  }));
}

const countState = (rows: readonly ProcessedRow[], state: RowState): number => rows.filter((r) => r.state === state).length;
const invalidRowCount = (csvErrors: readonly RowError[]): number => new Set(csvErrors.map((e) => e.rowNumber)).size;
const sumCredits = (rows: readonly ProcessedRow[]): Paise => rows.reduce((total, r) => total + r.creditPaise, 0n);

function summarise(rows: readonly ProcessedRow[], csvErrors: readonly RowError[]): Summary {
  const count = (state: RowState): number => countState(rows, state);
  const invalidRows = invalidRowCount(csvErrors);
  const sum = sumCredits;
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

/** The PAYMENT amount of a plan, or null when the plan has none or more than one. */
function onlyPayment(decision: RowDecision): PostingEntry | null {
  const payments = (decision.plan?.entries ?? []).filter((e) => e.entryType === "PAYMENT");
  return payments.length === 1 ? payments[0] : null;
}

/**
 * Takes in a whole statement: orders the rows, skips the ones an earlier import already took,
 * decides each of the others with matchRow, and lists the ledger entries to write for the
 * automatic matches.
 *
 * It works on its own copy of the flats' bills. After an automatic match it records the payment
 * on that copy before the next row is decided, so a second row that pays the same bill sees it as
 * paid and is queued, not posted twice. Rows that are queued or ignored change nothing. The
 * caller's input is never changed and nothing outside the arguments is read or written.
 * Throws RangeError for a bad flat list, bad settings or a negative amount.
 */
export function processStatement(input: ProcessInput): ProcessedStatement {
  const context = buildMatchContext(input.flats, input.settings);
  const ordered = [...input.rows].sort(byDateThenRow);
  const keys = computeRowKeys(input.rows);
  const taken = new Set<string>(input.alreadyImportedKeys);
  const rows: ProcessedRow[] = [];
  const entriesToPost: PlannedEntry[] = [];

  for (const row of ordered) {
    const parsed = parseNarration(row.narrationRaw);
    const dedupeKey = keys.get(row.rowNumber) as string;
    const header = { rowNumber: row.rowNumber, creditPaise: row.creditPaise, dedupeKey, parsed };

    if (taken.has(dedupeKey)) {
      rows.push({ ...header, state: "ALREADY_IMPORTED", decision: null });
      continue;
    }
    taken.add(dedupeKey);
    const decision = matchRow(context, row, parsed);
    const processed: ProcessedRow = { ...header, state: STATE_OF[decision.kind], decision };
    rows.push(processed);
    const payment = onlyPayment(decision);
    if (decision.kind === "AUTO_MATCH" && decision.flatCode !== null && payment !== null) {
      entriesToPost.push(...plannedEntries(processed, decision.flatCode, decision));
      recordPayment(context, decision.flatCode, payment.billKey, { date: row.txnDate, amountPaise: payment.amountPaise });
    }
  }
  const draft: ProcessedStatement = { rows, csvErrors: input.csvErrors.map((e) => ({ ...e })), summary: summarise(rows, input.csvErrors), accounted: false, entriesToPost };
  return { ...draft, accounted: accountingReport(draft).length === 0 };
}

/**
 * The statement after some AUTO_MATCHED rows could not be posted after all (the database changed under them): each is QUEUED
 * with `reason` added, has no plan, and its entries are removed from `entriesToPost`; the summary and `accounted` are worked out
 * again from the new rows. Rows that are not AUTO_MATCHED are left alone. Pure: the input is not changed.
 */
export function downgradeRows(processed: ProcessedStatement, rowNumbers: ReadonlySet<number>, why: Reason): ProcessedStatement {
  const downgraded = new Set(processed.rows.filter((r) => r.state === "AUTO_MATCHED" && rowNumbers.has(r.rowNumber)).map((r) => r.rowNumber));
  const rows = processed.rows.map((row): ProcessedRow =>
    downgraded.has(row.rowNumber) && row.decision !== null
      ? { ...row, state: "QUEUED", decision: { ...row.decision, kind: "QUEUE", plan: null, reasons: [...row.decision.reasons, why] } }
      : row,
  );
  const draft: ProcessedStatement = {
    rows,
    csvErrors: processed.csvErrors.map((e) => ({ ...e })),
    summary: summarise(rows, processed.csvErrors),
    accounted: false,
    entriesToPost: processed.entriesToPost.filter((e) => !downgraded.has(e.rowNumber)),
  };
  return { ...draft, accounted: accountingReport(draft).length === 0 };
}

/**
 * Checks, from the data, that every row of a statement is accounted for, and lists in plain English
 * each condition that is broken. It is empty when the statement is accounted for:
 * every row has exactly one valid state that agrees with its decision; the summary counts and
 * totals equal a fresh count of the rows; valid plus invalid rows equal the rows read; every
 * AUTO_MATCHED row has a plan with one PAYMENT equal to its credit; and the entries to post are
 * those plans, with unique idempotency keys.
 */
export function accountingReport(processed: ProcessedStatement): string[] {
  const problems: string[] = [];
  const { rows, summary, csvErrors, entriesToPost } = processed;
  const states: readonly RowState[] = ["AUTO_MATCHED", "QUEUED", "IGNORED", "ALREADY_IMPORTED"];

  for (const row of rows) {
    const label = `Row ${row.rowNumber}`;
    if (!states.includes(row.state)) problems.push(`${label} has no valid state.`);
    else if (row.state === "ALREADY_IMPORTED") {
      if (row.decision !== null) problems.push(`${label} is already imported but has a decision.`);
    } else if (row.decision === null) problems.push(`${label} is ${row.state} but has no decision.`);
    else if (STATE_OF[row.decision.kind] !== row.state) problems.push(`${label} is ${row.state} but its decision is ${row.decision.kind}.`);
    if (row.state === "AUTO_MATCHED" && row.decision !== null) {
      const payment = onlyPayment(row.decision);
      if (payment === null) problems.push(`${label} is automatically matched but its plan does not have exactly one PAYMENT.`);
      else if (payment.amountPaise !== row.creditPaise) problems.push(`${label} is automatically matched but its PAYMENT ${payment.amountPaise} is not its credit ${row.creditPaise}.`);
    }
  }
  const postedKeys = rows.filter((r) => r.state !== "ALREADY_IMPORTED").map((r) => r.dedupeKey);
  if (new Set(postedKeys).size !== postedKeys.length) problems.push("Two rows that were processed share a dedupe key.");

  const checks: [string, number | bigint, number | bigint][] = [
    ["autoMatched", summary.autoMatched, countState(rows, "AUTO_MATCHED")],
    ["queued", summary.queued, countState(rows, "QUEUED")],
    ["ignored", summary.ignored, countState(rows, "IGNORED")],
    ["alreadyImported", summary.alreadyImported, countState(rows, "ALREADY_IMPORTED")],
    ["validRows", summary.validRows, rows.length],
    ["invalidRows", summary.invalidRows, invalidRowCount(csvErrors)],
    ["creditTotalPaise", summary.creditTotalPaise, sumCredits(rows)],
    ["autoMatchedTotalPaise", summary.autoMatchedTotalPaise, sumCredits(rows.filter((r) => r.state === "AUTO_MATCHED"))],
  ];
  for (const [name, reported, actual] of checks) {
    if (reported !== actual) problems.push(`The summary says ${name} is ${reported} but the rows give ${actual}.`);
  }
  if (summary.autoMatched + summary.queued + summary.ignored + summary.alreadyImported !== summary.validRows) {
    problems.push("The four states do not add up to the valid rows.");
  }
  if (summary.validRows + summary.invalidRows !== summary.rowsRead) problems.push("Valid rows plus invalid rows do not equal the rows read.");

  const planned = rows.filter((r) => r.state === "AUTO_MATCHED").flatMap((r) => (r.decision?.plan?.entries ?? []).map((e) => `${r.rowNumber}|${e.entryType}|${e.amountPaise}|${e.billKey}`));
  const posted = entriesToPost.map((e) => `${e.rowNumber}|${e.entryType}|${e.amountPaise}|${e.billKey}`);
  if (planned.join(",") !== posted.join(",")) problems.push("The entries to post are not exactly the plans of the automatically matched rows.");
  if (new Set(entriesToPost.map((e) => e.idempotencyKey)).size !== entriesToPost.length) problems.push("Two entries to post share an idempotency key.");
  return problems;
}
