import { type Permission, can } from "@/domain/auth/permissions";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import type { ImportListEntry, SummaryCounts } from "@/lib/reconciliation/types";
import { getStatementSummary } from "./import";
import { listImports } from "./review";

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
