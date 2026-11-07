import type { Db } from "@/server/auth/db";
import { type BoardLane, chooseLane } from "@/lib/staff-complaints/lanes";
import { requirePermission } from "@/server/statements/ui-data";
import { autoCloseQuietly } from "./auto-close";
import { type Board, type BoardRow, listBoard } from "./board";
import { type Actor, isDutyManager } from "./context";

/** The data the staff landing page needs beyond the person's permissions: how many safety complaints are open (zero for a person without complaints:manage). */
export async function loadStaffLanding(input: { db: Db; user: Actor }): Promise<{ openSafety: number }> {
  try {
    requirePermission(input.user, "complaints:manage");
  } catch {
    return { openSafety: 0 };
  }
  return { openSafety: await input.db.complaint.count({ where: { safetyFlag: true, status: { not: "CLOSED" } } }) };
}

export type BoardPage = {
  lane: BoardLane;
  counts: Record<BoardLane, number>;
  rows: BoardRow[];
  nextCursor: string | null;
  /** The business clock at the time of the read: every "Reply due in 40 min" on the page is worked out from it. */
  now: number;
};

async function readBoard(input: { db: Db; user: Actor; lane: BoardLane; cursor?: string; now: number }): Promise<Board> {
  const board = await listBoard({ db: input.db, user: input.user, lane: input.lane, cursor: input.cursor, now: input.now });
  if (board.status === "ERROR") throw new Error(`complaints board: ${board.error}`);
  return board;
}

/**
 * The data of /staff/complaints (D130). The permission is checked here again, at the data (the page already sent anyone else away). Auto-close runs first,
 * lazily and quietly (D120), so a complaint that waited long enough shows as closed and a failure never breaks the page. With no lane in the address the
 * duty manager gets Safety when it has items, everybody else Needs triage; a second read is made only when a duty manager's Safety lane turns out empty.
 */
export async function loadBoardPage(input: { db: Db; user: Actor; requested: BoardLane | null; now: number }): Promise<BoardPage> {
  requirePermission(input.user, "complaints:manage");
  await autoCloseQuietly({ db: input.db, now: input.now });
  const dutyManager = isDutyManager(input.user);
  const first = input.requested ?? (dutyManager ? "SAFETY" : "NEEDS_TRIAGE");
  let board = await readBoard({ db: input.db, user: input.user, lane: first, now: input.now });
  const lane = chooseLane({ requested: input.requested, isDutyManager: dutyManager, safetyCount: board.counts.SAFETY });
  if (lane !== first) board = await readBoard({ db: input.db, user: input.user, lane, now: input.now });
  return { lane, counts: board.counts, rows: board.rows, nextCursor: board.nextCursor, now: input.now };
}

/** The next page of one lane after `cursor` ("Load more"). Needs complaints:manage. */
export async function loadBoardMore(input: { db: Db; user: Actor; lane: BoardLane; cursor: string; now: number }): Promise<{ rows: BoardRow[]; nextCursor: string | null }> {
  requirePermission(input.user, "complaints:manage");
  const board = await readBoard(input);
  return { rows: board.rows, nextCursor: board.nextCursor };
}
