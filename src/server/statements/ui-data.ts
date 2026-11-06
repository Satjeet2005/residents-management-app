import { type Permission, can } from "@/domain/auth/permissions";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { z } from "zod";
import type { Confidence, ImportListEntry, Lane, RowCard, SummaryCounts, WorkspaceHeader } from "@/lib/reconciliation/types";
import { getStatementSummary } from "./import";
import { listImports, listRows } from "./review";

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
  const stored = await db.bankRow.findMany({ where: { id: { in: page.items.map((i) => i.id) } }, select: { id: true, parsed: true } });
  const parsedOf = new Map(stored.map((r) => [r.id, r.parsed]));
  const rows = page.items.map(
    (item): RowCard => ({
      id: item.id,
      rowNumber: item.rowNumber,
      txnDate: item.txnDate,
      amountPaise: item.amountPaise,
      direction: item.direction,
      narration: item.narrationRaw,
      state: item.state,
      version: item.version,
      ...storedBest(parsedOf.get(item.id)),
      request: null,
      posted: null,
      ignored: null,
    }),
  );
  return { rows, nextCursor: page.nextCursor, laneCounts: page.laneCounts };
}

export type Workspace = {
  header: WorkspaceHeader;
  counts: SummaryCounts;
  laneCounts: Record<Lane, number>;
  rows: RowCard[];
  nextCursor: string | null;
};

/** The workspace of one import: header, the counts read back from the database, and the first page of the chosen lane. Needs payments:match. Null for an id that is not an import. */
export async function loadWorkspace({ db, user, importId, lane }: { db: Db; user: Viewer; importId: string; lane: Lane }): Promise<Workspace | null> {
  requirePermission(user, "payments:match");
  if (!z.uuid().safeParse(importId).success) return null;
  const [record, counts, cards] = await Promise.all([
    db.statementImport.findUnique({ where: { id: importId }, select: { filename: true, uploadedAt: true, uploadedBy: { select: { name: true } } } }),
    countsOf(db, importId),
    loadRowCards({ db, user, importId, lane }),
  ]);
  if (record === null || counts === null || cards === null) return null;
  return {
    header: { importId, filename: record.filename, uploadedOn: istDateOf(record.uploadedAt.getTime()), uploadedBy: record.uploadedBy.name },
    counts,
    laneCounts: cards.laneCounts,
    rows: cards.rows,
    nextCursor: cards.nextCursor,
  };
}
