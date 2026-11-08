import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client";
import { BOARD_VIEWS, type BoardView, isBoardView } from "@/domain/complaints/board-views";
import { type SlaState, slaState } from "@/domain/complaints/lifecycle";
import { type BoardFilters, NO_FILTERS } from "@/lib/staff-complaints/board-query";
import type { Db } from "@/server/auth/db";
import { complaintTitle } from "@/server/home/mapper";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Urgency } from "@/domain/complaints/taxonomy";
import { type Actor, canManage } from "./context";
import { type ComplaintFailure, failure } from "./errors";
import { VIEW_PAGE_SIZE } from "./page-size";

const PAGE_MAX = 50;

/** The duty manager's acknowledgement fact (D149): the complaints that have an `ack` event, once. Joined as `a`; `a.complaint_id IS NOT NULL` means acknowledged. */
const ACKS = Prisma.sql`LEFT JOIN (SELECT DISTINCT complaint_id FROM complaint_events WHERE event_type = 'COMMENT' AND payload->>'kind' = 'ack') a ON a.complaint_id = c.id`;
const ACKED = Prisma.sql`(a.complaint_id IS NOT NULL)`;

/** Safety complaints, of every month, that are not closed and that the duty manager has not acknowledged (the alert of the committee report): one query. */
export async function countUnacknowledgedSafety(db: Db): Promise<number> {
  const [row] = await db.$queryRaw<{ n: number }[]>`SELECT (count(*))::int AS n FROM complaints c ${ACKS} WHERE c.status <> 'CLOSED' AND c.safety_flag AND NOT ${ACKED}`;
  return row.n;
}

/** The SQL twin of `inView` (src/domain/complaints/board-views.ts). */
function viewPredicate(view: BoardView, viewerId: string, now: Date): Prisma.Sql {
  const open = Prisma.sql`c.status <> 'CLOSED'`;
  const missedOpen = Prisma.sql`(c.response_due_at IS NOT NULL AND c.first_response_at IS NULL AND c.response_due_at < ${now}::timestamptz)`;
  switch (view) {
    case "needs_action":
      return Prisma.sql`(${open} AND ((c.safety_flag AND NOT ${ACKED}) OR c.assignee_id IS NULL OR (c.needs_review AND c.status = 'NEW') OR (c.assignee_id = ${viewerId}::uuid AND (${missedOpen} OR c.status = 'REOPENED'))))`;
    case "mine":
      return Prisma.sql`(${open} AND c.assignee_id = ${viewerId}::uuid)`;
    case "safety":
      return Prisma.sql`(${open} AND c.safety_flag)`;
    case "triage":
      return Prisma.sql`(${open} AND (c.assignee_id IS NULL OR (c.needs_review AND c.status = 'NEW')))`;
    case "open":
      return Prisma.sql`(c.status IN ('ASSIGNED', 'IN_PROGRESS', 'REOPENED'))`;
    case "overdue":
      return Prisma.sql`(${open} AND ${missedOpen})`;
    case "waiting":
      return Prisma.sql`(c.status = 'PENDING_CONFIRMATION')`;
    case "closed":
      return Prisma.sql`(c.status = 'CLOSED')`;
  }
}

/** The filters as SQL. Values are bound parameters; the flat prefix only ever holds T, digits and a hyphen, and is compared with starts_with, so it has no wildcard. */
function filterPredicate(filters: BoardFilters, viewerId: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filters.category !== null) parts.push(Prisma.sql`c.category_id = (SELECT id FROM complaint_categories WHERE code = ${filters.category})`);
  if (filters.assignee === "me") parts.push(Prisma.sql`c.assignee_id = ${viewerId}::uuid`);
  if (filters.assignee === "unassigned") parts.push(Prisma.sql`c.assignee_id IS NULL`);
  if (filters.urgency !== null) parts.push(Prisma.sql`c.urgency = ${filters.urgency}::complaint_urgency`);
  if (filters.q !== null) parts.push(Prisma.sql`c.flat_id IN (SELECT id FROM flats WHERE starts_with(code, ${filters.q}))`);
  return Prisma.join(parts, " AND ");
}

export type ViewCounts = Record<BoardView, number>;

/** Every view's count (with the filters) and the unfiltered number of safety complaints waiting for the duty manager, in ONE query. */
async function viewCounts(db: Db, viewerId: string, filters: BoardFilters, now: Date): Promise<{ counts: ViewCounts; unacknowledgedSafety: number }> {
  const filter = filterPredicate(filters, viewerId);
  const columns = BOARD_VIEWS.map((view) => Prisma.sql`(count(*) FILTER (WHERE ${viewPredicate(view, viewerId, now)} AND ${filter}))::int AS ${Prisma.raw(view)}`);
  const [row] = await db.$queryRaw<(Record<BoardView, number> & { unacknowledged_safety: number })[]>`
    SELECT ${Prisma.join(columns)}, (count(*) FILTER (WHERE c.status <> 'CLOSED' AND c.safety_flag AND NOT ${ACKED}))::int AS unacknowledged_safety
    FROM complaints c ${ACKS}`;
  return { counts: Object.fromEntries(BOARD_VIEWS.map((view) => [view, row[view]])) as ViewCounts, unacknowledgedSafety: row.unacknowledged_safety };
}

/** Every view's count for one viewer, with no filters, and the unseen safety count: the numbers of the staff home, in ONE query (D187). */
export const boardCounts = (db: Db, viewerId: string, now: number): Promise<{ counts: ViewCounts; unacknowledgedSafety: number }> => viewCounts(db, viewerId, NO_FILTERS, new Date(now));

/** What the order of a non-closed view reads, as SQL: the band, then the first-reply due time (none last). Closed uses closed_at. */
const BAND = Prisma.sql`CASE WHEN c.status = 'CLOSED' THEN 3 WHEN c.safety_flag AND NOT ${ACKED} THEN 0 WHEN c.urgency IN ('CRITICAL', 'HIGH') THEN 1 ELSE 2 END`;
const DUE = Prisma.sql`COALESCE(c.response_due_at, 'infinity'::timestamptz)`;

/** A timestamptz as Postgres prints it, or `infinity`. */
const TIME = /^(infinity|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?)$/;
const cursorSchema = z.object({ r: z.number().int().min(0).max(3), d: z.string().regex(TIME), t: z.string().regex(TIME), id: z.uuid() });
type Cursor = z.infer<typeof cursorSchema>;
const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString("base64url");
function decodeCursor(text: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(text, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type BoardRow = {
  id: string;
  title: string;
  flatCode: string;
  category: string | null;
  urgency: Urgency;
  status: ComplaintStatus;
  safety: boolean;
  /** The duty manager has acknowledged it (an `ack` event); only meaningful for a safety complaint. */
  acknowledged: boolean;
  needsReview: boolean;
  assignee: { id: string; name: string } | null;
  /** Whole minutes since the complaint was raised. */
  ageMinutes: number;
  responseDueAt: number | null;
  sla: SlaState;
  /** Who classified it last: RULE, LLM, FALLBACK or MANUAL. */
  source: "RULE" | "LLM" | "FALLBACK" | "MANUAL" | null;
  version: number;
};
export type ViewBoard = { status: "OK"; view: BoardView; counts: ViewCounts; unacknowledgedSafety: number; total: number; rows: BoardRow[]; nextCursor: string | null };

/**
 * One page of one view (D151), in the order of the view, with a keyset cursor, and the count of every view. The cursor is opaque: the band, the due time, the
 * creation time and the id of the last row (the closed view: its closing time and id), so pages never repeat or skip a row, ties included. A cursor that is
 * not ours, an unknown view or a limit outside 1 to 50 is VALIDATION. Needs `complaints:manage`. `now` is a timestamp in milliseconds.
 */
export async function listBoardView(input: { db: Db; user: Actor; view: BoardView; filters?: BoardFilters; cursor?: string; limit?: number; now: number }): Promise<ViewBoard | ComplaintFailure> {
  if (!canManage(input.user)) return failure("FORBIDDEN");
  if (!isBoardView(input.view)) return failure("VALIDATION");
  const limit = input.limit ?? VIEW_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) return failure("VALIDATION");
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) return failure("VALIDATION");
  const now = new Date(input.now);
  const filters = input.filters ?? NO_FILTERS;
  const where = Prisma.sql`${viewPredicate(input.view, input.user.id, now)} AND ${filterPredicate(filters, input.user.id)}`;

  const closed = input.view === "closed";
  const after =
    cursor === null
      ? Prisma.empty
      : closed
        ? Prisma.sql`AND (k.sort_time < ${cursor.t}::timestamptz OR (k.sort_time = ${cursor.t}::timestamptz AND k.id < ${cursor.id}::uuid))`
        : Prisma.sql`AND (k.band > ${cursor.r} OR (k.band = ${cursor.r} AND k.due > ${cursor.d}::timestamptz)
            OR (k.band = ${cursor.r} AND k.due = ${cursor.d}::timestamptz AND k.created_at < ${cursor.t}::timestamptz)
            OR (k.band = ${cursor.r} AND k.due = ${cursor.d}::timestamptz AND k.created_at = ${cursor.t}::timestamptz AND k.id < ${cursor.id}::uuid))`;
  const order = closed ? Prisma.sql`k.sort_time DESC, k.id DESC` : Prisma.sql`k.band, k.due, k.created_at DESC, k.id DESC`;

  const [{ counts, unacknowledgedSafety }, page] = await Promise.all([
    viewCounts(input.db, input.user.id, filters, now),
    input.db.$queryRaw<{ id: string; band: number; due: string; created: string; sort: string; acked: boolean }[]>`
      SELECT k.id::text AS id, k.band, k.due::text AS due, k.created_at::text AS created, k.sort_time::text AS sort, k.acked FROM (
        SELECT c.id, c.created_at, ${BAND} AS band, ${DUE} AS due, COALESCE(c.closed_at, c.created_at) AS sort_time, ${ACKED} AS acked
        FROM complaints c ${ACKS} WHERE ${where}
      ) k
      WHERE TRUE ${after}
      ORDER BY ${order} LIMIT ${limit + 1}`,
  ]);
  const shown = page.slice(0, limit);
  const details = await input.db.complaint.findMany({
    where: { id: { in: shown.map((p) => p.id) } },
    select: {
      id: true, body: true, urgency: true, status: true, safetyFlag: true, needsReview: true, createdAt: true, responseDueAt: true, firstResponseAt: true, version: true,
      flat: { select: { code: true } },
      category: { select: { code: true } },
      assignee: { select: { id: true, name: true } },
      classifications: { orderBy: { createdAt: "desc" }, take: 1, select: { source: true } },
    },
  });
  const byId = new Map(details.map((d) => [d.id, d]));
  const rows = shown.flatMap((p): BoardRow[] => {
    const d = byId.get(p.id);
    if (d === undefined) return [];
    return [
      {
        id: d.id,
        title: complaintTitle(d.body),
        flatCode: d.flat.code,
        category: d.category?.code ?? null,
        urgency: d.urgency,
        status: d.status,
        safety: d.safetyFlag,
        needsReview: d.needsReview,
        assignee: d.assignee,
        ageMinutes: Math.max(0, Math.floor((input.now - d.createdAt.getTime()) / 60_000)),
        responseDueAt: d.responseDueAt?.getTime() ?? null,
        sla: slaState({ status: d.status, responseDueAt: d.responseDueAt?.getTime() ?? null, firstResponseAt: d.firstResponseAt?.getTime() ?? null, now: input.now }),
        source: d.classifications[0]?.source ?? null,
        version: d.version,
        acknowledged: p.acked,
      },
    ];
  });
  const last = shown.at(-1);
  const nextCursor = page.length > limit && last !== undefined ? encodeCursor({ r: last.band, d: last.due, t: closed ? last.sort : last.created, id: last.id }) : null;
  return { status: "OK", view: input.view, counts, unacknowledgedSafety, total: counts[input.view], rows, nextCursor };
}
