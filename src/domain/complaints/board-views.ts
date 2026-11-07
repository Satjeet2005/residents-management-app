import { slaOutcome } from "./sla";
import type { ComplaintStatus } from "./step";
import type { Urgency } from "./taxonomy";

/** The eight views of the staff board, in the order of the views sheet. The address names them (`?view=`). */
export const BOARD_VIEWS = ["needs_action", "mine", "safety", "triage", "open", "overdue", "waiting", "closed"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = "needs_action";
export const isBoardView = (value: unknown): value is BoardView => typeof value === "string" && (BOARD_VIEWS as readonly string[]).includes(value);

/** What a view needs to know about a complaint. `acknowledged` is the duty manager's acknowledgement fact (an `ack` event, D149). Times are milliseconds. */
export type ViewFacts = {
  status: ComplaintStatus;
  safetyFlag: boolean;
  acknowledged: boolean;
  assigneeId: string | null;
  needsReview: boolean;
  responseDueAt: number | null;
  firstResponseAt: number | null;
};

/** Not closed, and nobody is assigned or it is still NEW and flagged for review (D151). */
export const isTriage = (c: ViewFacts): boolean => c.status !== "CLOSED" && (c.assigneeId === null || (c.needsReview && c.status === "NEW"));

const missedOpen = (c: ViewFacts, now: number): boolean => slaOutcome({ responseDueAt: c.responseDueAt, firstResponseAt: c.firstResponseAt, now }) === "MISSED_OPEN";

/**
 * Whether a complaint is in a view, for the person `viewerId` (D151). The SQL of `src/server/complaints/board-views.ts` says the same thing and a test
 * compares the two on every row of the seeded database.
 * - needs_action: not closed, and one of: a safety complaint the duty manager has not acknowledged; nobody assigned; NEW and flagged for review; assigned to
 *   the viewer and either REOPENED or past its first-reply time with no reply.
 * - mine: not closed and assigned to the viewer. safety: a safety complaint that is not closed. triage: see `isTriage`. open: ASSIGNED, IN_PROGRESS or REOPENED.
 * - overdue: not closed and `slaOutcome` is MISSED_OPEN (no reply and the time has passed; a late reply or a late "resolved" is not overdue, D150).
 * - waiting: PENDING_CONFIRMATION. closed: CLOSED.
 */
export function inView(view: BoardView, c: ViewFacts, viewerId: string, now: number): boolean {
  const open = c.status !== "CLOSED";
  switch (view) {
    case "needs_action":
      return open && ((c.safetyFlag && !c.acknowledged) || c.assigneeId === null || (c.needsReview && c.status === "NEW") || (c.assigneeId === viewerId && (missedOpen(c, now) || c.status === "REOPENED")));
    case "mine":
      return open && c.assigneeId === viewerId;
    case "safety":
      return open && c.safetyFlag;
    case "triage":
      return isTriage(c);
    case "open":
      return c.status === "ASSIGNED" || c.status === "IN_PROGRESS" || c.status === "REOPENED";
    case "overdue":
      return open && missedOpen(c, now);
    case "waiting":
      return c.status === "PENDING_CONFIRMATION";
    case "closed":
      return c.status === "CLOSED";
  }
}

/** What the order of a view reads. `dueAt` null sorts last. */
export type RankFacts = { id: string; status: ComplaintStatus; safetyFlag: boolean; acknowledged: boolean; urgency: Urgency; responseDueAt: number | null; createdAt: number; closedAt: number | null };

/**
 * The band of a complaint: 0 an unacknowledged safety complaint (never a closed one), 1 CRITICAL or HIGH urgency, 2 anything else open, 3 closed.
 * A smaller band comes first.
 */
export function rankBand(c: RankFacts): 0 | 1 | 2 | 3 {
  if (c.status === "CLOSED") return 3;
  if (c.safetyFlag && !c.acknowledged) return 0;
  return c.urgency === "CRITICAL" || c.urgency === "HIGH" ? 1 : 2;
}

const byNumber = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order of a view, as a comparison (D151). Closed view: newest closed first. Every other view: band, then the oldest first-reply due time first (most
 * overdue first; no due time last), then newest created, then the larger id. The SQL ranking and its keyset cursor follow this exactly.
 */
export function compareForView(view: BoardView, a: RankFacts, b: RankFacts): number {
  if (view === "closed") return byNumber(b.closedAt ?? b.createdAt, a.closedAt ?? a.createdAt) || byText(b.id, a.id);
  return (
    byNumber(rankBand(a), rankBand(b)) ||
    byNumber(a.responseDueAt ?? Number.POSITIVE_INFINITY, b.responseDueAt ?? Number.POSITIVE_INFINITY) ||
    byNumber(b.createdAt, a.createdAt) ||
    byText(b.id, a.id)
  );
}
