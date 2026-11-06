import { createHash } from "node:crypto";
import { computeRowKeys } from "@/domain/matching/dedupe";
import { parseStatementCsv, type RowError, type StatementRow } from "@/domain/matching/csv";
import { type ProcessedRow, type ProcessedStatement, downgradeRows, processStatement } from "@/domain/matching/processor";
import { FIXED_REASONS } from "@/domain/matching/reasons";
import { positionsForFlat } from "@/domain/billing/dues";
import type { LateFeePolicy } from "@/domain/billing/late-fee";
import { planPosting } from "@/domain/billing/posting";
import type { Prisma } from "../../../generated/prisma/client";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { toDueBill, toDueEntry } from "@/server/home/mapper";
import { lockBill } from "@/server/payments/bill-lock";
import { bankIdempotencyKey, bankReferences } from "./reference";
import { loadMatchContext } from "./context";

export const IMPORT_LIMITS = { maxChars: 2_000_000, maxRows: 20_000 } as const;

/** A file that is refused before any database work. `code` says why; the route turns it into a status. */
export class StatementLimitError extends RangeError {
  constructor(
    readonly code: "TOO_LARGE" | "TOO_MANY_ROWS" | "NUL_BYTES",
    message: string,
  ) {
    super(message);
    this.name = "StatementLimitError";
  }
}

/** The books of an import did not add up, so nothing was saved. This is a bug, never an input problem. */
export class StatementAccountingError extends Error {}

/** Test seams: a test injects a concurrent commit after the snapshot, or a failure before the commit. Production callers pass none. */
export type ImportHooks = { afterSnapshot?: () => Promise<void>; beforeCommit?: () => Promise<void>; /** Shortens the 5 s wait for a lock, so a test of IMPORT_IN_PROGRESS does not take 5 s. */ lockTimeoutMs?: number };

export type ImportSummary = {
  rowsRead: number;
  validRows: number;
  invalidRows: number;
  autoMatched: number;
  queued: number;
  ignored: number;
  alreadyImported: number;
  /** Rows the processor wanted to post that were queued instead because the bill changed meanwhile (already counted in `queued`). */
  downgraded: number;
  /** Paise as decimal strings (JSON has no bigint). */
  creditTotalPaise: string;
  autoMatchedTotalPaise: string;
};

export type ImportResult =
  | { status: "IMPORTED"; importId: string; summary: ImportSummary; accounted: true; csvErrors: RowError[] }
  | { status: "INVALID_CSV"; errors: RowError[] }
  | { status: "IMPORT_IN_PROGRESS" };

/** What the database holds for one import, read back after writing. */
export type ReadBack = { stored: Record<"AUTO_MATCHED" | "QUEUED" | "IGNORED", number>; queueItems: number; payments: number; paymentTotalPaise: bigint };

const MAX_ERRORS_SHOWN = 50;
const CHUNK = 500;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
const dateOf = (calendarDate: string): Date => new Date(`${calendarDate}T00:00:00.000Z`);
const chunks = <T>(items: readonly T[], size = CHUNK): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_x, i) => items.slice(i * size, (i + 1) * size));

/** Postgres says "lock timeout" (SQLSTATE 55P03) in one of several places depending on the driver layer. */
function isLockTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const text = `${String(e.message ?? "")} ${JSON.stringify(e.meta ?? {})} ${JSON.stringify(e.cause ?? {})}`;
  return /55P03|lock timeout|lock_timeout/i.test(text);
}

const summaryOf = (processed: ProcessedStatement, downgraded: number): ImportSummary => ({
  ...processed.summary,
  downgraded,
  creditTotalPaise: processed.summary.creditTotalPaise.toString(),
  autoMatchedTotalPaise: processed.summary.autoMatchedTotalPaise.toString(),
});

/**
 * True only when the processor's books balance AND what was read back from the database equals them: the rows stored per state,
 * one open queue item per queued row, and exactly one PAYMENT per automatically matched row that adds up to its total.
 * Worked out from both sides; a corrupted copy of either makes it false.
 */
export function isAccounted(processed: ProcessedStatement, readBack: ReadBack): boolean {
  const { summary } = processed;
  const stored = readBack.stored.AUTO_MATCHED + readBack.stored.QUEUED + readBack.stored.IGNORED;
  return (
    processed.accounted &&
    readBack.stored.AUTO_MATCHED === summary.autoMatched &&
    readBack.stored.QUEUED === summary.queued &&
    readBack.stored.IGNORED === summary.ignored &&
    stored === summary.validRows - summary.alreadyImported &&
    readBack.queueItems === summary.queued &&
    readBack.payments === summary.autoMatched &&
    readBack.paymentTotalPaise === summary.autoMatchedTotalPaise
  );
}

async function readBackOf(tx: Prisma.TransactionClient, importId: string): Promise<ReadBack> {
  const [states, queueItems, payments] = await Promise.all([
    tx.bankRow.groupBy({ by: ["state"], where: { importId }, _count: { _all: true } }),
    tx.accountsQueueItem.count({ where: { itemType: "BANK_ROW", status: "OPEN", bankRow: { importId } } }),
    tx.ledgerEntry.aggregate({ where: { entryType: "PAYMENT", bankRow: { importId } }, _count: { _all: true }, _sum: { amountPaise: true } }),
  ]);
  const count = (state: string): number => states.find((s) => s.state === state)?._count._all ?? 0;
  return {
    stored: { AUTO_MATCHED: count("AUTO_MATCHED"), QUEUED: count("QUEUED"), IGNORED: count("IGNORED") },
    queueItems,
    payments: payments._count._all,
    paymentTotalPaise: payments._sum.amountPaise ?? 0n,
  };
}

/** Which of these dedupe keys are already stored, asked in chunks. */
async function storedKeys(tx: Prisma.TransactionClient, keys: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks([...new Set(keys)], 1000)) {
    for (const row of await tx.bankRow.findMany({ where: { dedupeKey: { in: part } }, select: { dedupeKey: true } })) found.add(row.dedupeKey);
  }
  return found;
}

/**
 * Takes the bills of the AUTO_MATCHED rows (locking each, in a fixed order) and reads their payments, late fees and adjustments
 * afresh, once. A row can no longer be posted when its bill is no longer PRINCIPAL_OPEN on the row's date, no longer owes exactly the
 * amount the plan pays, would not get exactly the entries the plan holds from `planPosting` (D107, D110), or has a live payment
 * dated after the row.
 * Returns those rows' numbers. The locks are held until the transaction ends, so what is read here is still true when the entries are written.
 */
async function staleRows(tx: Prisma.TransactionClient, processed: ProcessedStatement, policy: LateFeePolicy, flatIds: ReadonlyMap<string, string>): Promise<Set<number>> {
  const autos = processed.rows.filter((r) => r.state === "AUTO_MATCHED" && r.decision?.plan !== null && r.decision?.plan !== undefined);
  const billOf = (row: ProcessedRow): string => (row.decision?.plan?.entries[0]?.billKey ?? "");
  const billIds = [...new Set(autos.map(billOf))].sort();
  for (const billId of billIds) await lockBill(tx, billId);
  if (billIds.length === 0) return new Set();
  const bills = await tx.bill.findMany({ where: { id: { in: billIds } }, select: { id: true, flatId: true, period: true, issuedOn: true, dueOn: true, amountPaise: true } });
  const entries = await tx.ledgerEntry.findMany({
    where: { OR: [{ billId: { in: billIds }, entryType: { in: ["PAYMENT", "LATE_FEE", "ADJUSTMENT"] } }, { entryType: "REVERSAL", reverses: { billId: { in: billIds } } }] },
    select: { id: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true },
  });
  const byId = new Map(bills.map((b) => [b.id, b]));
  const due = entries.map(toDueEntry);
  const reversed = new Set(due.filter((e) => e.entryType === "REVERSAL").map((e) => e.reversesEntryId));
  const stale = new Set<number>();
  for (const row of autos) {
    const bill = byId.get(billOf(row));
    const flatCode = row.decision?.flatCode ?? null;
    const planned = row.decision?.plan?.entries.find((e) => e.entryType === "PAYMENT");
    if (bill === undefined || planned === undefined || flatCode === null || flatIds.get(flatCode) !== bill.flatId) {
      stale.add(row.rowNumber);
      continue;
    }
    const live = due.filter((e) => e.entryType === "PAYMENT" && e.billId === bill.id && !reversed.has(e.id));
    const rowDate = planned.effectiveDate;
    const position = positionsForFlat({ bills: [toDueBill(bill)], entries: due.filter((e) => e.billId === bill.id || e.entryType === "REVERSAL"), policy, asOf: rowDate })[0]?.position;
    const posting = position === undefined || position.kind !== "PRINCIPAL_OPEN" ? null : planPosting({ position, creditPaise: planned.amountPaise, paymentDate: rowDate });
    const held = row.decision?.plan?.entries ?? [];
    const sameEntries =
      posting !== null &&
      "entries" in posting &&
      posting.entries.length === held.length &&
      posting.entries.every((e, i) => held[i].entryType === e.entryType && held[i].amountPaise === e.amountPaise && held[i].effectiveDate === e.effectiveDate);
    if (!sameEntries || live.some((e) => e.effectiveDate > rowDate)) stale.add(row.rowNumber);
  }
  return stale;
}

type Prepared = { rows: StatementRow[]; csvErrors: RowError[] };

/** Reads the file and refuses what cannot be a statement, before any database work. */
function prepare(csvText: string): Prepared | { fatal: RowError[] } {
  if (csvText.length > IMPORT_LIMITS.maxChars) throw new StatementLimitError("TOO_LARGE", `The file is over ${IMPORT_LIMITS.maxChars} characters`);
  if (csvText.includes("\0")) throw new StatementLimitError("NUL_BYTES", "The file contains NUL bytes, so it is not a text statement");
  const parsed = parseStatementCsv(csvText);
  if (parsed.errors.some((e) => e.rowNumber === 0)) return { fatal: parsed.errors.filter((e) => e.rowNumber === 0) };
  if (parsed.rows.length + new Set(parsed.errors.map((e) => e.rowNumber)).size > IMPORT_LIMITS.maxRows) {
    throw new StatementLimitError("TOO_MANY_ROWS", `The file has more than ${IMPORT_LIMITS.maxRows} rows`);
  }
  return { rows: parsed.rows, csvErrors: parsed.errors };
}

/**
 * Takes in a bank statement (D45, D47, D50, D68, D70): the whole import is ONE transaction, and nothing is saved unless every row is accounted for.
 *
 * 1. The file is read and refused early (size, rows, NUL bytes; a bad header is INVALID_CSV). Nothing is stored for a refused file.
 * 2. The transaction takes `pg_advisory_xact_lock(hashtext('statement-import'))` with `lock_timeout` 5 s, so imports run one after the
 *    other (a wait that long is IMPORT_IN_PROGRESS), loads the matching context INSIDE the transaction, asks which dedupe keys are
 *    already stored, and runs the processor.
 * 3. Each AUTO_MATCHED row's bill is locked (the same `lockBill` the gateway uses, D104) and its payments are read afresh. A bill that
 *    changed since the snapshot (a gateway payment arrived) downgrades the row to QUEUED with STATE_CHANGED instead of paying it twice.
 * 4. It writes the import, a bank row for every NEW valid row (never for ALREADY_IMPORTED), the LATE_FEE and ONE PAYMENT of each automatic
 *    match (dated the row's date, the PAYMENT carrying the bank row), the payment_matches row, a queue item for each QUEUED row, and the audit rows.
 * 5. It reads the counts back and checks them against the processor's books; if they differ the transaction is rolled back (an error).
 */
export async function importStatement(input: { db: Db; user: Pick<SessionUser, "id">; filename: string; csvText: string; now: number; hooks?: ImportHooks }): Promise<ImportResult> {
  const prepared = prepare(input.csvText);
  if ("fatal" in prepared) return { status: "INVALID_CSV", errors: prepared.fatal.slice(0, MAX_ERRORS_SHOWN) };
  const { rows, csvErrors } = prepared;
  const rowByNumber = new Map(rows.map((r) => [r.rowNumber, r]));

  try {
    return await input.db.$transaction(
      async (tx): Promise<ImportResult> => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${input.hooks?.lockTimeoutMs === undefined ? "'5s'" : String(Math.trunc(input.hooks.lockTimeoutMs))}`);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('statement-import'))`;

        const { flats, settings } = await loadMatchContext(tx, input.now);
        const alreadyImportedKeys = await storedKeys(tx, [...computeRowKeys(rows).values()]);
        const processed = processStatement({ rows, csvErrors, flats, settings, alreadyImportedKeys });
        if (!processed.accounted) throw new StatementAccountingError("The processor's books do not add up");
        await input.hooks?.afterSnapshot?.();

        const flatIds = new Map((await tx.flat.findMany({ select: { id: true, code: true } })).map((f) => [f.code, f.id]));
        const stale = await staleRows(tx, processed, settings.lateFeePolicy, flatIds);
        const final = stale.size === 0 ? processed : downgradeRows(processed, stale, FIXED_REASONS.stateChanged);
        if (!final.accounted) throw new StatementAccountingError("The books do not add up after downgrading");

        const notes = JSON.stringify({ invalidRows: final.summary.invalidRows, alreadyImported: final.summary.alreadyImported, downgraded: stale.size, creditTotalPaise: final.summary.creditTotalPaise.toString() });
        const statementImport = await tx.statementImport.create({
          data: { uploadedById: input.user.id, filename: input.filename, fileSha256: createHash("sha256").update(input.csvText, "utf8").digest("hex"), rowsRead: final.summary.rowsRead, notes },
          select: { id: true },
        });

        // Every new valid row is stored QUEUED first (an AUTO_MATCHED row needs its ledger entry, which needs the row), IGNORED as it is.
        const fresh = final.rows.filter((r) => r.state !== "ALREADY_IMPORTED");
        const bankRowIds = new Map<number, string>();
        for (const part of chunks(fresh)) {
          const created = await tx.bankRow.createManyAndReturn({
            data: part.map((row) => {
              const source = rowByNumber.get(row.rowNumber) as StatementRow;
              return {
                importId: statementImport.id,
                rowNumber: row.rowNumber,
                txnDate: dateOf(source.txnDate),
                valueDate: source.valueDate === null ? null : dateOf(source.valueDate),
                narrationRaw: source.narrationRaw,
                creditPaise: source.creditPaise,
                debitPaise: source.debitPaise,
                balancePaise: source.balancePaise,
                dedupeKey: row.dedupeKey,
                parsed: json({ ...row.parsed, decision: decisionRecord(row) }),
                state: row.state === "IGNORED" ? ("IGNORED" as const) : ("QUEUED" as const),
              };
            }),
            select: { id: true, rowNumber: true },
          });
          for (const c of created) bankRowIds.set(c.rowNumber, c.id);
        }

        const autos = fresh.filter((r) => r.state === "AUTO_MATCHED");
        const queued = fresh.filter((r) => r.state === "QUEUED");
        const references = await bankReferences(
          tx,
          autos.map((row) => ({ key: row.rowNumber, source: { rail: row.parsed.rail, reference: row.parsed.reference, dedupeKey: row.dedupeKey } })),
        );
        const dedupeKeyOf = new Map(final.rows.map((r) => [r.rowNumber, r.dedupeKey]));
        const keyOf = (entry: { rowNumber: number; entryType: string }): string => bankIdempotencyKey(dedupeKeyOf.get(entry.rowNumber) as string, entry.entryType);
        const entryRows = final.entriesToPost.map((entry) => {
          const isPayment = entry.entryType === "PAYMENT";
          return {
            flatId: flatIds.get(entry.flatCode) as string,
            billId: entry.billKey,
            entryType: entry.entryType,
            direction: isPayment ? ("PAYMENT" as const) : ("CHARGE" as const),
            amountPaise: entry.amountPaise,
            effectiveDate: dateOf(entry.effectiveDate),
            bankRowId: isPayment ? (bankRowIds.get(entry.rowNumber) as string) : null,
            reference: isPayment ? (references.get(entry.rowNumber) as string) : null,
            idempotencyKey: keyOf(entry),
          };
        });
        const paymentIdByRow = new Map<number, string>();
        const ledgerIdByKey = new Map<string, string>();
        for (const part of chunks(entryRows)) {
          const created = await tx.ledgerEntry.createManyAndReturn({ data: part, select: { id: true, idempotencyKey: true, entryType: true } });
          for (const c of created) ledgerIdByKey.set(c.idempotencyKey, c.id);
        }
        for (const entry of final.entriesToPost) {
          if (entry.entryType === "PAYMENT") paymentIdByRow.set(entry.rowNumber, ledgerIdByKey.get(keyOf(entry)) as string);
        }
        for (const row of autos) {
          await tx.bankRow.update({
            where: { id: bankRowIds.get(row.rowNumber) as string },
            data: { state: "AUTO_MATCHED", flatId: flatIds.get(row.decision?.flatCode as string), ledgerEntryId: paymentIdByRow.get(row.rowNumber), version: { increment: 1 } },
            select: { id: true },
          });
        }
        await tx.paymentMatch.createMany({
          data: autos.map((row) => ({
            bankRowId: bankRowIds.get(row.rowNumber) as string,
            decision: "AUTO" as const,
            flatId: flatIds.get(row.decision?.flatCode as string),
            score: row.decision?.candidates[0]?.score ?? null,
            reasons: json(row.decision?.reasons ?? []),
            candidates: json(row.decision?.candidates ?? []),
          })),
        });
        await tx.accountsQueueItem.createMany({ data: queued.map((row) => ({ itemType: "BANK_ROW" as const, bankRowId: bankRowIds.get(row.rowNumber) as string })) });

        await tx.auditLog.create({
          data: { actorId: input.user.id, action: "STATEMENT_IMPORTED", entityType: "statement_import", entityId: statementImport.id, detail: json({ ...summaryOf(final, stale.size), importId: statementImport.id }) },
        });
        for (const part of chunks(autos, 50)) {
          await tx.auditLog.create({
            data: {
              actorId: input.user.id,
              action: "BANK_ROW_AUTO_POSTED",
              entityType: "statement_import",
              entityId: statementImport.id,
              detail: json({ importId: statementImport.id, bankRowIds: part.map((r) => bankRowIds.get(r.rowNumber)), ledgerEntryIds: part.map((r) => paymentIdByRow.get(r.rowNumber)) }),
            },
          });
        }

        if (!isAccounted(final, await readBackOf(tx, statementImport.id))) throw new StatementAccountingError("What was stored does not match what was decided");
        await input.hooks?.beforeCommit?.();
        return { status: "IMPORTED", importId: statementImport.id, summary: summaryOf(final, stale.size), accounted: true, csvErrors: final.csvErrors.slice(0, MAX_ERRORS_SHOWN) };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (isLockTimeout(error)) return { status: "IMPORT_IN_PROGRESS" };
    throw error;
  }
}

/** The decision of a row as kept in `bank_rows.parsed.decision`: at most five candidates, never the plan, no narration text. */
function decisionRecord(row: ProcessedRow): unknown {
  const d = row.decision;
  if (d === null) return null;
  return { kind: d.kind, confidence: d.confidence, reasons: d.reasons, candidates: d.candidates.slice(0, 5), totalCandidates: d.totalCandidates, ignoreKind: d.ignoreKind ?? null };
}

export type StatementSummary = { importId: string; filename: string; summary: Omit<ImportSummary, "autoMatchedTotalPaise">; accounted: boolean };

/**
 * An import's counts read from the database, not from memory: rows per state, the rows an earlier import already held and the rows the
 * reader refused (kept in the import's notes), and whether they add up to the rows read. Null for an id that is not an import.
 */
export async function getStatementSummary(db: Db, importId: string): Promise<StatementSummary | null> {
  const record = await db.statementImport.findUnique({ where: { id: importId }, select: { id: true, filename: true, rowsRead: true, notes: true } });
  if (record === null) return null;
  const states = await db.bankRow.groupBy({ by: ["state"], where: { importId }, _count: { _all: true } });
  const count = (state: string): number => states.find((s) => s.state === state)?._count._all ?? 0;
  const notes = JSON.parse(record.notes ?? "{}") as { invalidRows?: number; alreadyImported?: number; downgraded?: number; creditTotalPaise?: string };
  const stored = states.reduce((sum, s) => sum + s._count._all, 0);
  const invalidRows = notes.invalidRows ?? 0;
  const alreadyImported = notes.alreadyImported ?? 0;
  const validRows = stored + alreadyImported;
  return {
    importId: record.id,
    filename: record.filename,
    summary: {
      rowsRead: record.rowsRead,
      validRows,
      invalidRows,
      autoMatched: count("AUTO_MATCHED"),
      queued: count("QUEUED"),
      ignored: count("IGNORED"),
      alreadyImported,
      downgraded: notes.downgraded ?? 0,
      creditTotalPaise: notes.creditTotalPaise ?? "0",
    },
    accounted: validRows + invalidRows === record.rowsRead,
  };
}
