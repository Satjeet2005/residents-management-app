import { type SlaState, slaState } from "@/domain/complaints/lifecycle";
import type { Db } from "@/server/auth/db";
import { type TimelineLine, staffTimeline, userIdsIn } from "@/lib/staff-complaints/timeline";
import type { BoardView } from "@/domain/complaints/board-views";
import type { BoardFilters, BoardQuery } from "@/lib/staff-complaints/board-query";
import { requirePermission } from "@/server/statements/ui-data";
import { autoCloseQuietly } from "./auto-close";
import { type BoardRow, type ViewBoard, type ViewCounts, listBoardView } from "./board-views";
import { type Actor, isDutyManager, isUuid } from "./context";
import { type ClassificationLine, type StaffComplaint, getStaffComplaint, listStaffUsers } from "./staff-read";
import type { ControlViewer } from "@/lib/staff-complaints/controls";

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
  view: BoardView;
  filters: BoardFilters;
  counts: ViewCounts;
  /** Safety complaints waiting for the duty manager's acknowledgement, whatever the filters (the alert strip). */
  unacknowledgedSafety: number;
  /** How many complaints the view holds with the filters on ("Showing 15 of <total>"). */
  total: number;
  rows: BoardRow[];
  nextCursor: string | null;
  /** The business clock at the time of the read: every "Reply due in 40 min" on the page is worked out from it. */
  now: number;
};

async function readBoard(input: { db: Db; user: Actor; view: BoardView; filters: BoardFilters; cursor?: string; now: number }): Promise<ViewBoard> {
  const board = await listBoardView(input);
  if (board.status === "ERROR") throw new Error(`complaints board: ${board.error}`);
  return board;
}

/**
 * The data of /staff/complaints (D130, D151). The permission is checked here again, at the data (the page already sent anyone else away). Auto-close runs first,
 * lazily and quietly (D120), so a complaint that waited long enough shows as closed and a failure never breaks the page. The view and the filters come from the
 * address, already checked against their allowlists; the default view is needs_action for everybody.
 */
export async function loadBoardPage(input: { db: Db; user: Actor; query: BoardQuery; now: number }): Promise<BoardPage> {
  requirePermission(input.user, "complaints:manage");
  await autoCloseQuietly({ db: input.db, now: input.now });
  const board = await readBoard({ db: input.db, user: input.user, view: input.query.view, filters: input.query.filters, now: input.now });
  return { view: board.view, filters: input.query.filters, counts: board.counts, unacknowledgedSafety: board.unacknowledgedSafety, total: board.total, rows: board.rows, nextCursor: board.nextCursor, now: input.now };
}

/** The next page of one view after `cursor` ("Show 15 more"). Needs complaints:manage. */
export async function loadBoardMore(input: { db: Db; user: Actor; view: BoardView; filters: BoardFilters; cursor: string; now: number }): Promise<{ rows: BoardRow[]; nextCursor: string | null }> {
  requirePermission(input.user, "complaints:manage");
  const board = await readBoard(input);
  return { rows: board.rows, nextCursor: board.nextCursor };
}

export type ComplaintPage = {
  /** The business clock at the time of the read: the reply clock is worked out from it. */
  now: number;
  complaint: Omit<StaffComplaint, "events" | "classifications">;
  sla: SlaState;
  /** When a duty manager acknowledged it, or null (an acknowledgement is a COMMENT event with the kind "ack"). */
  acknowledgedAt: number | null;
  classifications: ClassificationLine[];
  /** Every event, internal ones included, each marked visible to the resident or internal. */
  timeline: TimelineLine[];
  /** Who may be assigned (active staff with complaints:manage), by name. */
  staffUsers: { id: string; name: string }[];
  /** Who is looking, for the controls of the action panel. */
  viewer: ControlViewer;
};

/**
 * The data of /staff/complaints/[id] (D130): the complaint with its FULL timeline. The permission is checked again here, at the data. A missing complaint and an
 * id that is not a UUID are both null (the page shows its not-found state). Auto-close runs first, lazily and quietly (D120). The names that events hold only as ids
 * (who a complaint was assigned to) are looked up once.
 */
export async function loadComplaintPage(input: { db: Db; user: Actor; id: string; now: number }): Promise<ComplaintPage | null> {
  requirePermission(input.user, "complaints:manage");
  if (!isUuid(input.id)) return null;
  await autoCloseQuietly({ db: input.db, now: input.now });
  const result = await getStaffComplaint(input);
  if (result.status === "ERROR") {
    if (result.error === "NOT_FOUND") return null;
    throw new Error(`complaint detail: ${result.error}`);
  }
  const { events, classifications, ...complaint } = result.complaint;
  const [users, assignable] = await Promise.all([input.db.user.findMany({ where: { id: { in: userIdsIn(events) } }, select: { id: true, name: true } }), listStaffUsers(input)]);
  if (assignable.status === "ERROR") throw new Error(`complaint detail: ${assignable.error}`);
  const ack = events.find((e) => e.eventType === "COMMENT" && typeof e.payload === "object" && e.payload !== null && (e.payload as { kind?: unknown }).kind === "ack");
  return {
    now: input.now,
    complaint,
    sla: slaState({ status: complaint.status, responseDueAt: complaint.responseDueAt, firstResponseAt: complaint.firstResponseAt, now: input.now }),
    acknowledgedAt: ack?.at ?? null,
    classifications,
    timeline: staffTimeline(events, new Map(users.map((u) => [u.id, u.name]))),
    staffUsers: assignable.users,
    viewer: { canManage: true, isDutyManager: isDutyManager(input.user) },
  };
}
