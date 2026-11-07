import { applyTransition } from "@/domain/complaints/lifecycle";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRY, withDeadlockRetry } from "@/server/db-retry";
import { type Actor, isDutyManager, isUuid, loadComplaintSettings } from "./context";
import { type ComplaintFailure, failure } from "./errors";
import { appendEvents } from "./events";
import { lockComplaint, writeLifecycle } from "./row";
import { auditComplaint } from "./staff-actions";

export type SafetyResult = { status: "OK"; complaint: { id: string; status: string; version: number } } | ComplaintFailure;

const NOTE_MIN = 5;
const NOTE_MAX = 500;

/**
 * The duty manager has seen a safety complaint (D39): first_response_at is set if still empty, and an event is appended: type COMMENT with payload
 * `{ kind: "ack" }`, which the resident never sees. A second acknowledgement changes nothing. Only for a safety complaint that is not closed
 * (else INVALID_TRANSITION). Needs `complaints:duty_manager`. It does not change the version.
 */
export async function acknowledgeSafety(input: { db: Db; user: Actor; id: string; now: number }): Promise<SafetyResult> {
  if (!isDutyManager(input.user)) return failure("FORBIDDEN");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  const settings = await loadComplaintSettings(input.db);
  return withDeadlockRetry(
    () =>
      input.db.$transaction(
        async (tx): Promise<SafetyResult> => {
          const row = await lockComplaint(tx, input.id);
          if (row === null) return failure("NOT_FOUND");
          if (!row.safetyFlag || row.status === "CLOSED") return failure("INVALID_TRANSITION");
          const result = applyTransition(row, { kind: "RESPOND" }, input.now, settings.lifecycle);
          if (!result.ok) return failure(result.refusal);
          const already = await tx.complaintEvent.count({ where: { complaintId: row.id, eventType: "COMMENT", payload: { path: ["kind"], equals: "ack" } } });
          if (already === 0) {
            if (row.firstResponseAt === null) await tx.complaint.update({ where: { id: row.id }, data: { firstResponseAt: new Date(input.now) }, select: { id: true } });
            await appendEvents(tx, row.id, [{ eventType: "COMMENT", actorId: input.user.id, payload: { kind: "ack" } }], input.now);
            await auditComplaint(tx, { actorId: input.user.id, action: "COMPLAINT_ACKNOWLEDGED", complaintId: row.id, detail: {}, now: input.now });
          }
          return { status: "OK", complaint: { id: row.id, status: row.status, version: row.version } };
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    TRANSACTION_RETRY,
  );
}

/**
 * Only the duty manager closes a safety complaint (D15, D39): CLOSED with close_kind DUTY_MANAGER, a note of 5 to 500 characters (VALIDATION), a CLOSED
 * event and an audit row. A complaint that is not a safety complaint, or is already closed, is INVALID_TRANSITION. The resident may still reopen it
 * within 7 days. Needs `complaints:duty_manager`.
 */
export async function closeSafety(input: { db: Db; user: Actor; id: string; note: string; now: number }): Promise<SafetyResult> {
  if (!isDutyManager(input.user)) return failure("FORBIDDEN");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const length = Array.from(note).length;
  if (length < NOTE_MIN || length > NOTE_MAX) return failure("VALIDATION");
  const settings = await loadComplaintSettings(input.db);
  return withDeadlockRetry(
    () =>
      input.db.$transaction(
        async (tx): Promise<SafetyResult> => {
          const row = await lockComplaint(tx, input.id);
          if (row === null) return failure("NOT_FOUND");
          const result = applyTransition(row, { kind: "CLOSE_SAFETY" }, input.now, settings.lifecycle);
          if (!result.ok) return failure(result.refusal);
          const version = await writeLifecycle(tx, row.id, result.fields);
          await appendEvents(tx, row.id, [{ eventType: "CLOSED", actorId: input.user.id, payload: { closeKind: "DUTY_MANAGER", note, rating: null } }], input.now);
          await auditComplaint(tx, { actorId: input.user.id, action: "COMPLAINT_SAFETY_CLOSED", complaintId: row.id, detail: { from: row.status }, now: input.now });
          return { status: "OK", complaint: { id: row.id, status: result.fields.status, version } };
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    TRANSACTION_RETRY,
  );
}
