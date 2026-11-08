import { can } from "@/domain/auth/permissions";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { boardCounts } from "@/server/complaints/board-views";
import { countsOf } from "@/server/statements/ui-data";
import { warnStaffHomeCountFailed } from "@/server/warnings";

type Viewer = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

export type StaffHomeData = {
  /** The staff board's two counts for this person, or null when they may not use the board or the read failed. */
  complaints: { needsAction: number; overdue: number } | null;
  /** Open safety complaints without the duty manager's acknowledgement; null unless the person is the duty manager (or the read failed). */
  unseenSafety: number | null;
  /** Bank statement matching: the newest import and the totals over ALL imports; null when the person may not match or the read failed. */
  statements: { newest: { importId: string; filename: string; uploadedOn: string; rowsRead: number; accounted: boolean } | null; needsPerson: number; awaitingApproval: number } | null;
  /** Rows waiting for THIS person's approval, over all imports (the ones they asked for themselves are not counted), and the newest import that has any. */
  approvals: { waiting: number; importId: string | null } | null;
};

/** Runs one count; a failure is logged once and gives null, so a card is shown without numbers and the page never crashes. */
async function quietly<T>(part: "complaints" | "statements" | "approvals", read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    warnStaffHomeCountFailed(part);
    return null;
  }
}

/**
 * The numbers of /staff (D187), all from SELECTs: the complaint board's own counts (one query), the reconciliation totals over every import, and the rows waiting
 * for this person's approval. The committee report is NOT loaded here. Nothing on the page names a resident, a phone or a narration.
 */
export async function loadStaffHome({ db, user, now }: { db: Db; user: Viewer; now: number }): Promise<StaffHomeData> {
  const manages = can(user, "complaints:manage");
  const matches = can(user, "payments:match");
  const approves = can(user, "payments:approve");
  const duty = can(user, "complaints:duty_manager");

  const board = manages ? await quietly("complaints", () => boardCounts(db, user.id, now)) : null;

  const statements = matches
    ? await quietly("statements", async () => {
        const [newest, totals] = await Promise.all([
          db.statementImport.findFirst({ orderBy: [{ uploadedAt: "desc" }, { id: "asc" }], select: { id: true, filename: true, uploadedAt: true, rowsRead: true } }),
          db.$queryRaw<{ needs: number; awaiting: number }[]>`SELECT (count(*) FILTER (WHERE state = 'QUEUED'))::int AS needs, (count(*) FILTER (WHERE state = 'AWAITING_APPROVAL'))::int AS awaiting FROM bank_rows`,
        ]);
        const counts = newest === null ? null : await countsOf(db, newest.id);
        return {
          newest: newest === null || counts === null ? null : { importId: newest.id, filename: newest.filename, uploadedOn: istDateOf(newest.uploadedAt.getTime()), rowsRead: newest.rowsRead, accounted: counts.accounted },
          needsPerson: totals[0].needs,
          awaitingApproval: totals[0].awaiting,
        };
      })
    : null;

  const approvals = approves
    ? await quietly("approvals", async () => {
        const groups = await db.$queryRaw<{ import_id: string; n: number }[]>`
          SELECT r.import_id::text AS import_id, (count(*))::int AS n
          FROM bank_rows r JOIN statement_imports i ON i.id = r.import_id
          WHERE r.state = 'AWAITING_APPROVAL'
            AND (SELECT m.decided_by_id FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' ORDER BY m.decided_at DESC, m.id DESC LIMIT 1) IS DISTINCT FROM ${user.id}::uuid
          GROUP BY r.import_id, i.uploaded_at
          ORDER BY i.uploaded_at DESC, r.import_id`;
        return { waiting: groups.reduce((sum, g) => sum + g.n, 0), importId: groups[0]?.import_id ?? null };
      })
    : null;

  return {
    complaints: board === null ? null : { needsAction: board.counts.needs_action, overdue: board.counts.overdue },
    unseenSafety: duty && board !== null ? board.unacknowledgedSafety : null,
    statements,
    approvals,
  };
}
