import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client";
import { type SlaState, slaState } from "@/domain/complaints/lifecycle";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Urgency } from "@/domain/complaints/taxonomy";
import type { Db } from "@/server/auth/db";
import { complaintTitle } from "@/server/home/mapper";
import { type Actor, canManage } from "./context";
import { type ComplaintFailure, failure } from "./errors";

export const LANES = ["NEEDS_TRIAGE", "OPEN", "OVERDUE", "WAITING_RESIDENT", "SAFETY", "CLOSED"] as const;
export type Lane = (typeof LANES)[number];
export const BOARD_PAGE_DEFAULT = 25;
export const BOARD_PAGE_MAX = 50;

/**
 * What puts a complaint in a lane (a complaint can be in several; the counts are per lane, not a partition). `now` is a timestamp.
 * - NEEDS_TRIAGE: not closed, and needs_review or no assignee.
 * - OPEN: assigned, in progress or reopened (a reopened complaint is work that is open again).
 * - OVERDUE: not closed, and either nobody has responded and the due time has passed, or it was marked resolved after the due time.
 * - WAITING_RESIDENT: marked resolved, waiting for the resident.
 * - SAFETY: a safety complaint that is not closed.
 * - CLOSED: closed.
 */
function predicate(lane: Lane, now: Date): Prisma.Sql {
  switch (lane) {
    case "NEEDS_TRIAGE":
      return Prisma.sql`(c.status <> 'CLOSED' AND (c.needs_review OR c.assignee_id IS NULL))`;
    case "OPEN":
      return Prisma.sql`(c.status IN ('ASSIGNED', 'IN_PROGRESS', 'REOPENED'))`;
    case "OVERDUE":
      return Prisma.sql`(c.status <> 'CLOSED' AND ((c.first_response_at IS NULL AND c.response_due_at < ${now}::timestamptz) OR (c.pending_confirmation_at IS NOT NULL AND c.pending_confirmation_at > c.response_due_at)))`;
    case "WAITING_RESIDENT":
      return Prisma.sql`(c.status = 'PENDING_CONFIRMATION')`;
    case "SAFETY":
      return Prisma.sql`(c.safety_flag AND c.status <> 'CLOSED')`;
    case "CLOSED":
      return Prisma.sql`(c.status = 'CLOSED')`;
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
export type Board = { status: "OK"; lane: Lane; counts: Record<Lane, number>; rows: BoardRow[]; nextCursor: string | null };

/** A Postgres timestamptz as text, "2026-11-06 06:30:00.123456+00", exactly as the query gave it. */
const cursorSchema = z.object({ t: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/), id: z.uuid() });
const encodeCursor = (t: string, id: string): string => Buffer.from(JSON.stringify({ t, id })).toString("base64url");
function decodeCursor(cursor: string): { t: string; id: string } | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return parsed.success && !Number.isNaN(Date.parse(`${parsed.data.t.slice(0, 10)}T${parsed.data.t.slice(11, 19)}Z`)) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The lane counts, in one query. */
async function laneCounts(db: Db, now: Date): Promise<Record<Lane, number>> {
  const [row] = await db.$queryRaw<{ needs_triage: number; open: number; overdue: number; waiting_resident: number; safety: number; closed: number }[]>`
    SELECT
      (count(*) FILTER (WHERE ${predicate("NEEDS_TRIAGE", now)}))::int AS needs_triage,
      (count(*) FILTER (WHERE ${predicate("OPEN", now)}))::int AS open,
      (count(*) FILTER (WHERE ${predicate("OVERDUE", now)}))::int AS overdue,
      (count(*) FILTER (WHERE ${predicate("WAITING_RESIDENT", now)}))::int AS waiting_resident,
      (count(*) FILTER (WHERE ${predicate("SAFETY", now)}))::int AS safety,
      (count(*) FILTER (WHERE ${predicate("CLOSED", now)}))::int AS closed
    FROM complaints c`;
  return { NEEDS_TRIAGE: row.needs_triage, OPEN: row.open, OVERDUE: row.overdue, WAITING_RESIDENT: row.waiting_resident, SAFETY: row.safety, CLOSED: row.closed };
}

/**
 * The staff board: one lane, newest first (by creation time, then id), with keyset pagination (an opaque cursor: the creation time and id of the last
 * row; a bad cursor is VALIDATION), and the count of every lane. Needs `complaints:manage`.
 */
export async function listBoard(input: { db: Db; user: Actor; lane: Lane; cursor?: string; limit?: number; now: number }): Promise<Board | ComplaintFailure> {
  if (!canManage(input.user)) return failure("FORBIDDEN");
  if (!LANES.includes(input.lane)) return failure("VALIDATION");
  const limit = input.limit ?? BOARD_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > BOARD_PAGE_MAX) return failure("VALIDATION");
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) return failure("VALIDATION");
  const now = new Date(input.now);

  const after = cursor === null ? Prisma.empty : Prisma.sql`AND (c.created_at, c.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`;
  const [counts, page] = await Promise.all([
    laneCounts(input.db, now),
    input.db.$queryRaw<{ id: string; cursor_time: string }[]>`
      SELECT c.id::text AS id, c.created_at::text AS cursor_time FROM complaints c
      WHERE ${predicate(input.lane, now)} ${after}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit + 1}`,
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
      },
    ];
  });
  const last = shown.at(-1);
  return { status: "OK", lane: input.lane, counts, rows, nextCursor: page.length > limit && last !== undefined ? encodeCursor(last.cursor_time, last.id) : null };
}
