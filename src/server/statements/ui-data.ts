import { type Permission, can } from "@/domain/auth/permissions";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { z } from "zod";
import type { Confidence, EntryLine, ImportListEntry, Lane, ReviewData, RowCard, SummaryCounts, WorkspaceHeader } from "@/lib/reconciliation/types";
import { getStatementSummary } from "./import";
import { bankIdempotencyKey } from "./reference";
import { getRowReview, listImports, listRows } from "./review";

/** Thrown by a loader for a person who does not hold the permission. A page has already sent such a person away; this is the second lock at the data. */
export class StaffAccessError extends Error {
  constructor(readonly permission: Permission) {
    super(`Missing permission ${permission}`);
    this.name = "StaffAccessError";
  }
}

type Viewer = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

export function requirePermission(user: Viewer, permission: Permission): void {
  if (!can(user, permission)) throw new StaffAccessError(permission);
}

/** The counts of one import read from the database: rows per state, and the accounted flag of `getStatementSummary`. Null for an id that is not an import. */
export async function countsOf(db: Db, importId: string): Promise<SummaryCounts | null> {
  const [summary, states] = await Promise.all([getStatementSummary(db, importId), db.bankRow.groupBy({ by: ["state"], where: { importId }, _count: { _all: true } })]);
  if (summary === null) return null;
  const count = (state: string): number => states.find((s) => s.state === state)?._count._all ?? 0;
  return {
    rowsRead: summary.summary.rowsRead,
    autoMatched: count("AUTO_MATCHED"),
    manuallyMatched: count("MANUALLY_MATCHED"),
    needsYou: count("QUEUED"),
    awaitingApproval: count("AWAITING_APPROVAL"),
    notMaintenance: count("IGNORED"),
    alreadyImported: summary.summary.alreadyImported,
    invalidRows: summary.summary.invalidRows,
    accounted: summary.accounted,
  };
}

/** The recent imports for the table (newest first, at most 10), each with its counts read back from the database. Needs payments:match. */
export async function loadImportList({ db, user }: { db: Db; user: Viewer }): Promise<ImportListEntry[]> {
  requirePermission(user, "payments:match");
  const imports = await listImports({ db, limit: 10 });
  const counts = await Promise.all(imports.map((i) => countsOf(db, i.importId)));
  return imports.flatMap((i, index) => {
    const c = counts[index];
    if (c === null) return [];
    return [
      {
        importId: i.importId,
        filename: i.filename,
        uploadedOn: istDateOf(Date.parse(i.uploadedAt)),
        rowsRead: c.rowsRead,
        posted: c.autoMatched + c.manuallyMatched,
        needsYou: c.needsYou,
        awaitingApproval: c.awaitingApproval,
        ignored: c.notMaintenance,
        accounted: c.accounted,
      },
    ];
  });
}

export const PAGE_SIZE = 25;

type DecisionRow = {
  bankRowId: string;
  decision: string;
  reason: string | null;
  reasons: unknown;
  decidedAt: Date;
  decidedBy: { id: string; name: string } | null;
  approver: { name: string } | null;
};

/** The decisions of the given rows, oldest first. The log is append-only, so the last of a kind is the current one. */
async function decisionsOf(db: Db, ids: readonly string[]): Promise<Map<string, DecisionRow[]>> {
  const found = await db.paymentMatch.findMany({
    where: { bankRowId: { in: [...ids] } },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    select: { bankRowId: true, decision: true, reason: true, reasons: true, decidedAt: true, decidedBy: { select: { id: true, name: true } }, approver: { select: { name: true } } },
  });
  return Map.groupBy(found, (d) => d.bankRowId);
}

const requestReasons = z.object({ action: z.enum(["MATCH", "IGNORE"]), flatCode: z.string().optional() });

/** Who asked for approval, for what, why and when: the latest REQUEST_APPROVAL decision of the row. */
function requestOf(history: readonly DecisionRow[]): RowCard["request"] {
  const request = history.findLast((d) => d.decision === "REQUEST_APPROVAL");
  const action = requestReasons.safeParse(request?.reasons);
  if (request === undefined || request.decidedBy === null || !action.success) return null;
  return {
    requestedById: request.decidedBy.id,
    requestedBy: request.decidedBy.name,
    action: action.data.action,
    flatCode: action.data.flatCode ?? null,
    reason: request.reason ?? "",
    requestedOn: istDateOf(request.decidedAt.getTime()),
  };
}

/** Automatic, or by whom (and who approved it): the decision that posted the row. */
function postedBy(history: readonly DecisionRow[]): NonNullable<RowCard["posted"]>["by"] {
  const posting = history.findLast((d) => d.decision === "AUTO" || d.decision === "MANUAL" || d.decision === "APPROVED");
  if (posting === undefined || posting.decision === "AUTO" || posting.decidedBy === null) return { kind: "AUTO" };
  return { kind: "MANUAL", name: posting.decidedBy.name, approvedBy: posting.approver?.name ?? null };
}

/** The reason a person gave for setting a row aside (an IGNORE, or an approved ignore). An automatic ignore has none. */
function ignoreReasonOf(history: readonly DecisionRow[]): string | null {
  return history.findLast((d) => d.decision === "IGNORE" || d.decision === "APPROVED")?.reason ?? null;
}

const storedIgnore = z.object({ ignoreKind: z.string().nullish() });
function storedIgnoreKind(parsed: unknown): string | null {
  const decision = storedIgnore.safeParse((parsed as { decision?: unknown } | null)?.decision);
  return decision.success ? (decision.data.ignoreKind ?? null) : null;
}

/** The entries a posted row made: its LATE_FEE (when there was one) and its PAYMENT, found by their idempotency keys (the bank's hashed key or the manual one). */
async function postedEntries(db: Db, rows: readonly { id: string; dedupeKey: string }[]): Promise<Map<string, EntryLine[]>> {
  const keyOwner = new Map<string, string>();
  for (const row of rows) {
    for (const type of ["LATE_FEE", "PAYMENT"]) {
      keyOwner.set(bankIdempotencyKey(row.dedupeKey, type), row.id);
      keyOwner.set(`manual:${row.id}:${type}`, row.id);
    }
  }
  const found = await db.ledgerEntry.findMany({ where: { idempotencyKey: { in: [...keyOwner.keys()] } }, select: { idempotencyKey: true, entryType: true, amountPaise: true }, orderBy: [{ entryType: "asc" }] });
  const byRow = new Map<string, EntryLine[]>();
  for (const entry of found) {
    const owner = keyOwner.get(entry.idempotencyKey);
    if (owner !== undefined) byRow.set(owner, [...(byRow.get(owner) ?? []), { entryType: entry.entryType, amountPaise: entry.amountPaise.toString() }]);
  }
  return byRow;
}

const storedDecision = z.object({ confidence: z.string().optional(), candidates: z.array(z.object({ flatCode: z.string() })).optional() });
const CONFIDENCES: readonly string[] = ["HIGH", "MEDIUM", "LOW", "NONE"];

/** The matcher's best candidate and confidence kept with a row, read out of `bank_rows.parsed.decision`. */
function storedBest(parsed: unknown): { bestFlat: string | null; confidence: Confidence | null } {
  const decision = storedDecision.safeParse((parsed as { decision?: unknown } | null)?.decision);
  if (!decision.success) return { bestFlat: null, confidence: null };
  const confidence = decision.data.confidence;
  return { bestFlat: decision.data.candidates?.[0]?.flatCode ?? null, confidence: confidence !== undefined && CONFIDENCES.includes(confidence) ? (confidence as Confidence) : null };
}

/**
 * One page of one lane as cards (keyset, biggest amount first): the T12b `listRows` page plus the best candidate flat of each row.
 * Needs payments:match. Null for an id that is not an import.
 */
export async function loadRowCards({ db, user, importId, lane, cursor }: { db: Db; user: Viewer; importId: string; lane: Lane; cursor?: string }): Promise<{ rows: RowCard[]; nextCursor: string | null; laneCounts: Record<Lane, number> } | null> {
  requirePermission(user, "payments:match");
  const page = await listRows({ db, importId, lane, cursor, limit: PAGE_SIZE });
  if (page === null) return null;
  const ids = page.items.map((i) => i.id);
  const stored = await db.bankRow.findMany({ where: { id: { in: ids } }, select: { id: true, parsed: true, dedupeKey: true } });
  const storedOf = new Map(stored.map((r) => [r.id, r]));
  const decisions = lane === "NEEDS_YOU" ? new Map<string, DecisionRow[]>() : await decisionsOf(db, ids);
  const entries = lane === "MATCHED" ? await postedEntries(db, stored) : new Map<string, EntryLine[]>();
  const rows = page.items.map((item): RowCard => {
    const row = storedOf.get(item.id);
    const history = decisions.get(item.id) ?? [];
    return {
      id: item.id,
      rowNumber: item.rowNumber,
      txnDate: item.txnDate,
      amountPaise: item.amountPaise,
      direction: item.direction,
      narration: item.narrationRaw,
      state: item.state,
      version: item.version,
      ...storedBest(row?.parsed),
      request: lane === "AWAITING_APPROVAL" ? requestOf(history) : null,
      posted: lane === "MATCHED" && item.flatCode !== null ? { flatCode: item.flatCode, by: postedBy(history), entries: entries.get(item.id) ?? [] } : null,
      ignored: lane === "NOT_MAINTENANCE" ? { ignoreKind: storedIgnoreKind(row?.parsed), reason: ignoreReasonOf(history) } : null,
    };
  });
  return { rows, nextCursor: page.nextCursor, laneCounts: page.laneCounts };
}

export type Workspace = {
  header: WorkspaceHeader;
  /** The row chosen with ?row=, when it belongs to this import. */
  review: ReviewData | null;
  counts: SummaryCounts;
  laneCounts: Record<Lane, number>;
  rows: RowCard[];
  nextCursor: string | null;
};

/** The workspace of one import: header, the counts read back from the database, and the first page of the chosen lane. Needs payments:match. Null for an id that is not an import. */
export async function loadWorkspace({ db, user, importId, lane, rowId, now }: { db: Db; user: Viewer; importId: string; lane: Lane; rowId?: string | null; now: number }): Promise<Workspace | null> {
  requirePermission(user, "payments:match");
  if (!z.uuid().safeParse(importId).success) return null;
  const [record, counts, cards, review] = await Promise.all([
    db.statementImport.findUnique({ where: { id: importId }, select: { filename: true, uploadedAt: true, uploadedBy: { select: { name: true } } } }),
    countsOf(db, importId),
    loadRowCards({ db, user, importId, lane }),
    rowId === undefined || rowId === null ? Promise.resolve(null) : loadReview({ db, user, importId, rowId, now }),
  ]);
  if (record === null || counts === null || cards === null) return null;
  return {
    header: { importId, filename: record.filename, uploadedOn: istDateOf(record.uploadedAt.getTime()), uploadedBy: record.uploadedBy.name },
    review,
    counts,
    laneCounts: cards.laneCounts,
    rows: cards.rows,
    nextCursor: cards.nextCursor,
  };
}

const parsedFacts = z.object({ rail: z.string().nullish(), reference: z.string().nullish(), vpa: z.string().nullish(), remitterName: z.string().nullish() });

/** society_settings approval_threshold_paise as paise. A missing or invalid setting is an error, never a guess (D14, D116). */
export async function readThreshold(db: Db): Promise<bigint> {
  const setting = await db.societySetting.findUnique({ where: { key: "approval_threshold_paise" }, select: { value: true } });
  const parsed = z.number().int().positive().safeParse(setting?.value);
  if (!parsed.success) throw new Error("The approval_threshold_paise setting is missing or not valid");
  return BigInt(parsed.data);
}

/**
 * Everything the review panel shows for one row of this import: the bank's facts (the narration in full, the rail, the reference,
 * the payer's name and UPI id as the narration reader found them), the stored reasons, the candidates with their open positions,
 * and the approval threshold from the society setting. Needs payments:match. Null for a row that is not in this import.
 */
export async function loadReview({ db, user, importId, rowId, now }: { db: Db; user: Viewer; importId: string; rowId: string; now: number }): Promise<ReviewData | null> {
  requirePermission(user, "payments:match");
  const review = await getRowReview({ db, rowId, now });
  if (review === null || review.importId !== importId) return null;
  const facts = parsedFacts.safeParse(review.parsed ?? {});
  const f = facts.success ? facts.data : {};
  return {
    id: review.id,
    importId: review.importId,
    version: review.version,
    state: review.state,
    txnDate: review.txnDate,
    creditPaise: review.creditPaise,
    narration: review.narrationRaw,
    rail: f.rail ?? null,
    reference: f.reference ?? null,
    payerName: f.remitterName ?? null,
    upiId: f.vpa ?? null,
    reasons: review.decision?.reasons ?? [],
    candidates: review.candidates.map((c) => ({ flatCode: c.flatCode, tower: c.tower, residents: c.residents, openPositions: c.openPositions, amountRelation: c.amountRelation })),
    thresholdPaise: (await readThreshold(db)).toString(),
  };
}
