import type { ComplaintStatus } from "@/domain/complaints/step";
import type { TimelineEventType } from "@/domain/complaints/timeline";
import type { Urgency } from "@/domain/complaints/taxonomy";
import type { Db } from "@/server/auth/db";
import { type Actor, canManage, isUuid } from "./context";
import { type ComplaintFailure, failure } from "./errors";

export type StaffEvent = { id: string; eventType: TimelineEventType; at: number; actor: { id: string; name: string } | null; payload: unknown };
export type ClassificationLine = { source: "RULE" | "LLM" | "FALLBACK" | "MANUAL"; category: string | null; urgency: Urgency; confidence: number | null; latencyMs: number | null; outputHash: string | null; at: number };
export type StaffComplaint = {
  id: string;
  body: string;
  language: string | null;
  flatCode: string;
  raisedBy: string;
  category: string | null;
  urgency: Urgency;
  status: ComplaintStatus;
  safety: boolean;
  needsReview: boolean;
  assignee: { id: string; name: string } | null;
  createdAt: number;
  responseDueAt: number | null;
  firstResponseAt: number | null;
  pendingConfirmationAt: number | null;
  closedAt: number | null;
  closeKind: string | null;
  rating: number | null;
  reopenCount: number;
  version: number;
  /** Every event, oldest first, with who did it (staff see the whole timeline, CLASSIFIED and internal notes included). */
  events: StaffEvent[];
  /** Every classification, newest first. */
  classifications: ClassificationLine[];
};
export type StaffComplaintResult = { status: "OK"; complaint: StaffComplaint } | ComplaintFailure;

/** One complaint with its FULL event timeline and classification history. Needs `complaints:manage`. */
export async function getStaffComplaint(input: { db: Db; user: Actor; id: string }): Promise<StaffComplaintResult> {
  if (!canManage(input.user)) return failure("FORBIDDEN");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  const row = await input.db.complaint.findUnique({
    where: { id: input.id },
    include: {
      flat: { select: { code: true } },
      raisedBy: { select: { name: true } },
      category: { select: { code: true } },
      assignee: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, name: true } } } },
      classifications: { orderBy: { createdAt: "desc" }, include: { category: { select: { code: true } } } },
    },
  });
  if (row === null) return failure("NOT_FOUND");
  return {
    status: "OK",
    complaint: {
      id: row.id,
      body: row.body,
      language: row.language,
      flatCode: row.flat.code,
      raisedBy: row.raisedBy.name,
      category: row.category?.code ?? null,
      urgency: row.urgency,
      status: row.status,
      safety: row.safetyFlag,
      needsReview: row.needsReview,
      assignee: row.assignee,
      createdAt: row.createdAt.getTime(),
      responseDueAt: row.responseDueAt?.getTime() ?? null,
      firstResponseAt: row.firstResponseAt?.getTime() ?? null,
      pendingConfirmationAt: row.pendingConfirmationAt?.getTime() ?? null,
      closedAt: row.closedAt?.getTime() ?? null,
      closeKind: row.closeKind,
      rating: row.rating,
      reopenCount: row.reopenCount,
      version: row.version,
      events: row.events.map((e) => ({ id: e.id, eventType: e.eventType, at: e.createdAt.getTime(), actor: e.actor, payload: e.payload })),
      classifications: row.classifications.map((c) => ({
        source: c.source,
        category: c.category?.code ?? null,
        urgency: c.urgency,
        confidence: c.confidence === null ? null : Number(c.confidence),
        latencyMs: c.latencyMs,
        outputHash: c.outputHash,
        at: c.createdAt.getTime(),
      })),
    },
  };
}

/** The people a complaint may be assigned to, for the assign control: active STAFF with `complaints:manage`, by name. Needs `complaints:manage`. */
export async function listStaffUsers(input: { db: Db; user: Actor }): Promise<{ status: "OK"; users: { id: string; name: string }[] } | ComplaintFailure> {
  if (!canManage(input.user)) return failure("FORBIDDEN");
  const users = await input.db.user.findMany({ where: { role: "STAFF", active: true, permissions: { some: { permission: "complaints:manage" } } }, select: { id: true, name: true } });
  users.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  return { status: "OK", users };
}
