import { applyTransition } from "@/domain/complaints/lifecycle";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRIES, withDeadlockRetry } from "@/server/db-retry";
import { type Actor, currentFlat, isResident, isUuid, loadComplaintSettings } from "./context";
import { type ComplaintFailure, failure } from "./errors";
import { appendEvents } from "./events";
import { lockComplaint, writeLifecycle } from "./row";

export type ResidentActionResult = { status: "OK"; complaint: { id: string; status: ComplaintStatus; rating: number | null; reopenCount: number } } | ComplaintFailure;

/**
 * The shared body of the two resident actions. ONE transaction: the complaint (of the resident's own current flat) is locked, the lifecycle decides
 * (`applyTransition`), the fields are written with the version raised, and the event is appended. A second call after the first sees the new status and
 * is refused as INVALID_TRANSITION. Residents never change the assignee, the category or the first response.
 */
async function residentAction(
  input: { db: Db; user: Actor; id: string; now: number },
  action: Parameters<typeof applyTransition>[1],
  event: (fields: { rating: number | null; reopenCount: number }) => { eventType: "CLOSED" | "REOPENED"; payload: Record<string, string | number | null> },
): Promise<ResidentActionResult> {
  if (!isResident(input.user)) return failure("FORBIDDEN");
  if (!isUuid(input.id)) return failure("NOT_FOUND");
  const flat = await currentFlat(input.db, input.user.id, input.now);
  if (flat === null) return failure("NO_FLAT");
  const settings = await loadComplaintSettings(input.db);
  return withDeadlockRetry(
    () =>
      input.db.$transaction(
        async (tx): Promise<ResidentActionResult> => {
          const row = await lockComplaint(tx, input.id, { flatId: flat.flatId });
          if (row === null) return failure("NOT_FOUND");
          const result = applyTransition(row, action, input.now, settings.lifecycle);
          if (!result.ok) return failure(result.refusal);
          await writeLifecycle(tx, row.id, result.fields);
          const { eventType, payload } = event(result.fields);
          await appendEvents(tx, row.id, [{ eventType, actorId: input.user.id, payload }], input.now);
          return { status: "OK", complaint: { id: row.id, status: result.fields.status, rating: result.fields.rating, reopenCount: result.fields.reopenCount } };
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    { retries: TRANSACTION_RETRIES },
  );
}

/** The resident says it is fixed: PENDING_CONFIRMATION becomes CLOSED, CONFIRMED, with an optional rating from 1 to 5 (D15). */
export function confirmFixed(input: { db: Db; user: Actor; id: string; rating?: number; now: number }): Promise<ResidentActionResult> {
  return residentAction(input, { kind: "CONFIRM", rating: input.rating }, (f) => ({ eventType: "CLOSED", payload: { closeKind: "CONFIRMED", rating: f.rating } }));
}

/** The resident says it is not fixed: a reason of 5 to 500 characters is required; the complaint is REOPENED, the closure fields are cleared and the reopen count goes up (D15). Allowed within 7 days of closing. */
export function reopen(input: { db: Db; user: Actor; id: string; reason: string; now: number }): Promise<ResidentActionResult> {
  return residentAction(input, { kind: "REOPEN", reason: input.reason }, (f) => ({ eventType: "REOPENED", payload: { reason: input.reason.trim(), reopenCount: f.reopenCount } }));
}
