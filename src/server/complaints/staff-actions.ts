import { applyTransition, type LifecycleAction } from "@/domain/complaints/lifecycle";
import { isCategoryCode } from "@/domain/complaints/taxonomy";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRY, withDeadlockRetry } from "@/server/db-retry";
import { type Actor, type Tx, canManage, isUuid, loadComplaintSettings } from "./context";
import { type ComplaintFailure, failure } from "./errors";
import { type NewEvent, appendEvents } from "./events";
import { outputHash } from "./output-hash";
import { type LockedComplaint, lockComplaint, writeLifecycle } from "./row";
import { isAssignable } from "./staff";

export type StaffActionResult = { status: "OK"; complaint: { id: string; status: ComplaintStatus; version: number; assigneeId: string | null } } | ComplaintFailure;

const versionOk = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000;

/** One row of the audit log for a staff action: who, what, which complaint. No complaint text and no personal data. */
export async function auditComplaint(tx: Tx, entry: { actorId: string; action: string; complaintId: string; detail: Record<string, string | number | boolean | null>; now: number }): Promise<void> {
  await tx.auditLog.create({ data: { actorId: entry.actorId, action: entry.action, entityType: "complaint", entityId: entry.complaintId, detail: entry.detail, createdAt: new Date(entry.now) } });
}

type Plan = { action: LifecycleAction | null; extra?: { assigneeId?: string | null; categoryId?: string | null; needsReview?: boolean }; events: NewEvent[]; audit: { action: string; detail: Record<string, string | number | boolean | null> }; after?: (tx: Tx) => Promise<void> };

/**
 * The shared body of the staff actions that change a complaint. ONE transaction: the row is locked, `expectedVersion` must be the current version
 * (else STALE), the lifecycle decides (INVALID_TRANSITION), the fields are written with the version raised, the events and one audit row are appended.
 * `plan` is given the locked row and may refuse with a failure.
 */
async function staffAction(
  input: { db: Db; user: Actor; id: string; expectedVersion: number; now: number },
  plan: (row: LockedComplaint, tx: Tx) => Promise<Plan | ComplaintFailure>,
): Promise<StaffActionResult> {
  if (!canManage(input.user)) return failure("FORBIDDEN");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  if (!versionOk(input.expectedVersion)) return failure("VALIDATION");
  const settings = await loadComplaintSettings(input.db);
  return withDeadlockRetry(
    () =>
      input.db.$transaction(
        async (tx): Promise<StaffActionResult> => {
          const row = await lockComplaint(tx, input.id);
          if (row === null) return failure("NOT_FOUND");
          if (row.version !== input.expectedVersion) return failure("STALE");
          const planned = await plan(row, tx);
          if ("status" in planned) return planned;
          let fields = { status: row.status, closedAt: row.closedAt, closeKind: row.closeKind, pendingConfirmationAt: row.pendingConfirmationAt, reopenCount: row.reopenCount, rating: row.rating, firstResponseAt: row.firstResponseAt };
          if (planned.action !== null) {
            const result = applyTransition(row, planned.action, input.now, settings.lifecycle);
            if (!result.ok) return failure(result.refusal);
            fields = result.fields;
          }
          const version = await writeLifecycle(tx, row.id, fields, planned.extra);
          await appendEvents(tx, row.id, planned.events, input.now);
          await auditComplaint(tx, { actorId: input.user.id, action: planned.audit.action, complaintId: row.id, detail: planned.audit.detail, now: input.now });
          if (planned.after) await planned.after(tx);
          return { status: "OK", complaint: { id: row.id, status: fields.status, version, assigneeId: planned.extra?.assigneeId === undefined ? row.assigneeId : planned.extra.assigneeId } };
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    TRANSACTION_RETRY,
  );
}

/** Assigns the complaint to an active staff user who holds `complaints:manage` (else ASSIGNEE_INVALID). NEW and REOPENED become ASSIGNED; the first staff action sets first_response_at. */
export function assign(input: { db: Db; user: Actor; id: string; assigneeUserId: string; expectedVersion: number; now: number }): Promise<StaffActionResult> {
  return staffAction(input, async (row, tx) => {
    if (!isUuid(input.assigneeUserId) || !(await isAssignable(tx, input.assigneeUserId))) return failure("ASSIGNEE_INVALID");
    return {
      action: { kind: "ASSIGN" },
      extra: { assigneeId: input.assigneeUserId },
      events: [{ eventType: "ASSIGNED", actorId: input.user.id, payload: { assignee: input.assigneeUserId, from: row.assigneeId } }],
      audit: { action: "COMPLAINT_ASSIGNED", detail: { assignee: input.assigneeUserId } },
    };
  });
}

/** IN_PROGRESS, or PENDING_CONFIRMATION ("mark resolved", never for a safety complaint). The note is optional, at most 500 characters, and internal. */
export function setStatus(input: { db: Db; user: Actor; id: string; status: "IN_PROGRESS" | "PENDING_CONFIRMATION"; note?: string; expectedVersion: number; now: number }): Promise<StaffActionResult> {
  return staffAction(input, async (row) => {
    const note = input.note === undefined ? null : input.note.trim();
    if (input.status !== "IN_PROGRESS" && input.status !== "PENDING_CONFIRMATION") return failure("VALIDATION");
    if (note !== null && Array.from(note).length > 500) return failure("VALIDATION");
    return {
      action: { kind: input.status === "IN_PROGRESS" ? "START" : "MARK_RESOLVED" },
      events: [{ eventType: "STATUS_CHANGED", actorId: input.user.id, payload: { from: row.status, to: input.status, note: note === "" ? null : note } }],
      audit: { action: "COMPLAINT_STATUS_CHANGED", detail: { from: row.status, to: input.status } },
    };
  });
}

const COMMENT_MAX = 1000;

/**
 * A staff comment. The text is 1 to 1,000 characters after trimming; `visibleToResident` says whether the resident sees it (an internal note is
 * not). It sets first_response_at if still empty, and does not change the version (a comment never makes another person's pending change stale).
 */
export async function addComment(input: { db: Db; user: Actor; id: string; text: string; visibleToResident: boolean; now: number }): Promise<{ status: "OK"; eventId: string } | ComplaintFailure> {
  if (!canManage(input.user)) return failure("FORBIDDEN");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text === "" || Array.from(text).length > COMMENT_MAX || typeof input.visibleToResident !== "boolean") return failure("VALIDATION");
  const settings = await loadComplaintSettings(input.db);
  return withDeadlockRetry(
    () =>
      input.db.$transaction(
        async (tx): Promise<{ status: "OK"; eventId: string } | ComplaintFailure> => {
          const row = await lockComplaint(tx, input.id);
          if (row === null) return failure("NOT_FOUND");
          const result = applyTransition(row, { kind: "RESPOND" }, input.now, settings.lifecycle);
          if (!result.ok) return failure(result.refusal);
          if (row.firstResponseAt === null) await tx.complaint.update({ where: { id: row.id }, data: { firstResponseAt: new Date(input.now) }, select: { id: true } });
          await appendEvents(tx, row.id, [{ eventType: "COMMENT", actorId: input.user.id, payload: { body: text, visibleToResident: input.visibleToResident } }], input.now);
          await auditComplaint(tx, { actorId: input.user.id, action: "COMPLAINT_COMMENTED", complaintId: row.id, detail: { visibleToResident: input.visibleToResident }, now: input.now });
          const last = await tx.complaintEvent.findFirstOrThrow({ where: { complaintId: row.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
          return { status: "OK", eventId: last.id };
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    TRANSACTION_RETRY,
  );
}

/** A person fixes the category: a CATEGORY_CORRECTED event, a MANUAL classifications row, needs_review cleared. A category the complaint already has (and no review pending) is VALIDATION. */
export function correctCategory(input: { db: Db; user: Actor; id: string; category: string; expectedVersion: number; now: number }): Promise<StaffActionResult> {
  return staffAction(input, async (row, tx) => {
    if (!isCategoryCode(input.category)) return failure("VALIDATION");
    const target = await tx.complaintCategory.findUnique({ where: { code: input.category }, select: { id: true, code: true } });
    if (target === null) return failure("VALIDATION");
    if (row.categoryId === target.id && !row.needsReview) return failure("VALIDATION");
    const before = row.categoryId === null ? null : ((await tx.complaintCategory.findUnique({ where: { id: row.categoryId }, select: { code: true } }))?.code ?? null);
    return {
      action: null,
      extra: { categoryId: target.id, needsReview: false },
      events: [{ eventType: "CATEGORY_CORRECTED", actorId: input.user.id, payload: { from: before, to: target.code } }],
      audit: { action: "COMPLAINT_CATEGORY_CORRECTED", detail: { from: before, to: target.code } },
      after: async (inner) => {
        await inner.classification.create({
          data: { complaintId: row.id, source: "MANUAL", categoryId: target.id, urgency: row.urgency, confidence: null, latencyMs: null, outputHash: outputHash({ category: target.code, urgency: row.urgency, by: input.user.id }), createdAt: new Date(input.now) },
        });
      },
    };
  });
}
