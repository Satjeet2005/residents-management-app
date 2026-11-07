import { type TimelineEntry, residentTimeline } from "@/domain/complaints/timeline";
import { type ComplaintStatus, complaintStep } from "@/domain/complaints/step";
import type { Db } from "@/server/auth/db";
import { replyDueText } from "@/lib/home-text";
import { complaintTitle, computeReplyDue } from "@/server/home/mapper";
import type { ReplyDue } from "@/server/home/types";
import { type Actor, currentFlat, isResident, isUuid, loadComplaintSettings } from "./context";
import { type ComplaintFailure, failure } from "./errors";

/** A complaint in the resident's list, with the Home's four steps and its reply-due line. */
export type OwnComplaintLine = {
  id: string;
  title: string;
  status: ComplaintStatus;
  /** The index of the current step, 0 to 3 (the Home's mapping: Raised, Assigned, In progress, Resolved). */
  current: 0 | 1 | 2 | 3;
  needsAnswer: boolean;
  reply: ReplyDue | null;
  /** "Reply due today, 5 pm" or "Reply overdue" in English; null once someone has replied or the complaint is closed. */
  replyText: string | null;
  createdAt: number;
};
export type OwnComplaintList = { status: "OK"; complaints: OwnComplaintLine[] } | ComplaintFailure;

/** The most complaints one list returns. */
export const OWN_LIST_LIMIT = 100;

const toLine = (row: { id: string; body: string; status: ComplaintStatus; createdAt: Date; responseDueAt: Date | null; firstResponseAt: Date | null }, now: number): OwnComplaintLine => {
  const step = complaintStep(row.status);
  const reply = row.status === "CLOSED" ? null : computeReplyDue({ responseDueAt: row.responseDueAt?.getTime() ?? null, firstResponseAt: row.firstResponseAt?.getTime() ?? null, now });
  return { id: row.id, title: complaintTitle(row.body), status: row.status, current: step.current, needsAnswer: step.needsAnswer, reply, replyText: reply === null ? null : replyDueText(reply), createdAt: row.createdAt.getTime() };
};

/**
 * The complaints of the resident's CURRENT flat (the Home's rule), open ones first, each group newest first. A closed complaint has no reply line.
 * The flat comes from the person's memberships, never from the request.
 */
export async function listOwnComplaints(input: { db: Db; user: Actor; now: number }): Promise<OwnComplaintList> {
  if (!isResident(input.user)) return failure("FORBIDDEN");
  const flat = await currentFlat(input.db, input.user.id, input.now);
  if (flat === null) return failure("NO_FLAT");
  const rows = await input.db.complaint.findMany({
    where: { flatId: flat.flatId },
    orderBy: { createdAt: "desc" },
    take: OWN_LIST_LIMIT,
    select: { id: true, body: true, status: true, createdAt: true, responseDueAt: true, firstResponseAt: true },
  });
  const lines = rows.map((row) => toLine(row, input.now));
  return { status: "OK", complaints: [...lines.filter((l) => l.status !== "CLOSED"), ...lines.filter((l) => l.status === "CLOSED")] };
}

export type OwnComplaint = OwnComplaintLine & {
  /** The words as the resident wrote them. */
  body: string;
  flatCode: string;
  safety: boolean;
  rating: number | null;
  reopenCount: number;
  /** True while the resident may reopen it: waiting for an answer, or closed and within the reopen window. */
  canReopen: boolean;
  timeline: TimelineEntry[];
};
export type OwnComplaintResult = { status: "OK"; complaint: OwnComplaint } | ComplaintFailure;

/**
 * One complaint of the resident's current flat, with the timeline a resident may see (src/domain/complaints/timeline.ts). A complaint of another
 * flat, or one that does not exist, is NOT_FOUND: the two cannot be told apart.
 */
export async function getComplaint(input: { db: Db; user: Actor; id: string; now: number }): Promise<OwnComplaintResult> {
  if (!isResident(input.user)) return failure("FORBIDDEN");
  const flat = await currentFlat(input.db, input.user.id, input.now);
  if (flat === null) return failure("NO_FLAT");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  const row = await input.db.complaint.findFirst({
    where: { id: input.id, flatId: flat.flatId },
    select: {
      id: true, body: true, status: true, createdAt: true, responseDueAt: true, firstResponseAt: true, safetyFlag: true, rating: true, reopenCount: true, closedAt: true,
      events: { orderBy: { createdAt: "asc" }, select: { eventType: true, createdAt: true, payload: true } },
    },
  });
  if (row === null) return failure("NOT_FOUND");
  const settings = await loadComplaintSettings(input.db);
  const window = settings.lifecycle.reopenWindowDays;
  const withinWindow = row.closedAt !== null && input.now <= row.closedAt.getTime() + window * 86_400_000;
  return {
    status: "OK",
    complaint: {
      ...toLine(row, input.now),
      body: row.body,
      flatCode: flat.flatCode,
      safety: row.safetyFlag,
      rating: row.rating,
      reopenCount: row.reopenCount,
      canReopen: row.status === "PENDING_CONFIRMATION" || (row.status === "CLOSED" && withinWindow),
      timeline: residentTimeline(row.events.map((e) => ({ eventType: e.eventType, createdAt: e.createdAt.getTime(), payload: e.payload }))),
    },
  };
}
