import { applyTransition } from "@/domain/complaints/lifecycle";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRY, withDeadlockRetry } from "@/server/db-retry";
import { loadComplaintSettings } from "./context";
import { appendEvents } from "./events";
import { lockComplaint, writeLifecycle } from "./row";

const DAY_MS = 86_400_000;
const CHUNK = 100;

/**
 * Closes every NON-SAFETY complaint that has waited `auto_close_days` (default 7) in PENDING_CONFIRMATION: CLOSED, AUTO_CLOSED, with a CLOSED event, and
 * returns how many it closed (D15, D120). A safety complaint is never closed here (it is not even looked at). There is no cron: the board and the
 * resident's list call this when they load. It is idempotent, and safe against a resident confirming at the same moment: each complaint is locked and
 * decided again by the lifecycle inside its own transaction, so whoever gets the lock first wins and the other sees the new status and does nothing.
 */
export async function autoCloseDue(input: { db: Db; now: number }): Promise<number> {
  const settings = await loadComplaintSettings(input.db);
  const cutoff = new Date(input.now - settings.lifecycle.autoCloseDays * DAY_MS);
  let closed = 0;
  const tried = new Set<string>();
  for (;;) {
    const due = await input.db.complaint.findMany({
      where: { status: "PENDING_CONFIRMATION", safetyFlag: false, pendingConfirmationAt: { lte: cutoff }, id: { notIn: [...tried] } },
      orderBy: { pendingConfirmationAt: "asc" },
      take: CHUNK,
      select: { id: true },
    });
    if (due.length === 0) return closed;
    for (const { id } of due) {
      tried.add(id);
      const done = await withDeadlockRetry(
        () =>
          input.db.$transaction(
            async (tx): Promise<boolean> => {
              const row = await lockComplaint(tx, id);
              if (row === null) return false;
              const result = applyTransition(row, { kind: "AUTO_CLOSE" }, input.now, settings.lifecycle);
              if (!result.ok) return false;
              await writeLifecycle(tx, row.id, result.fields);
              await appendEvents(tx, row.id, [{ eventType: "CLOSED", actorId: null, payload: { closeKind: "AUTO_CLOSED", rating: null } }], input.now);
              return true;
            },
            { timeout: 30_000, maxWait: 10_000 },
          ),
        TRANSACTION_RETRY,
      );
      if (done) closed += 1;
    }
  }
}

/** The lazy call of a screen or route that loads complaints (D120): a failure must not break the page, so it is logged without data and ignored. */
export async function autoCloseQuietly(input: { db: Db; now: number }): Promise<void> {
  try {
    await autoCloseDue(input);
  } catch {
    console.error("auto-close failed");
  }
}
