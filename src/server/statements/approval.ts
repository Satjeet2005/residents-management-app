import { z } from "zod";
import { can } from "@/domain/auth/permissions";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRY, withDeadlockRetry } from "@/server/db-retry";
import {
  type ActingUser,
  type ManualFailure,
  type PayerNotice,
  type RemainingAfter,
  approvalThreshold,
  audit,
  failure,
  lockAndReadRow,
  planUnderLock,
  postMatch,
  reasonSchema,
  resolveQueueItem,
} from "./manual-core";
import { loadPolicy } from "./positions";

const requestedAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("MATCH"), flatCode: z.string(), rememberPayer: z.boolean(), billId: z.string(), amountDuePaise: z.string().regex(/^[0-9]{1,18}$/) }),
  z.object({ action: z.literal("IGNORE") }),
]);

export type IgnoreResult = { status: "IGNORED" } | { status: "AWAITING_APPROVAL"; thresholdPaise: string } | ManualFailure;

/**
 * Staff mark a QUEUED credit row as not a maintenance payment (for example a hall rent or a refund). A reason of 5 to 500 characters
 * is required. Below the approval threshold the row becomes IGNORED, an IGNORE decision is recorded and the queue item is RESOLVED.
 * At or above it nothing is decided yet: the row is AWAITING_APPROVAL with a REQUEST_APPROVAL decision {action: IGNORE} and the queue
 * item stays OPEN (D14). `expectedVersion` guards against a row that someone else changed.
 */
export async function ignoreRow(input: { db: Db; user: ActingUser; rowId: string; reason: string; expectedVersion: number; now: number }): Promise<IgnoreResult> {
  if (!can(input.user, "payments:match")) return failure("FORBIDDEN");
  if (!z.uuid().safeParse(input.rowId).success) return failure("NOT_FOUND");
  const reason = reasonSchema.safeParse(input.reason);
  if (!reason.success) return failure("REASON_REQUIRED");
  return withDeadlockRetry(() => input.db.$transaction(
    async (tx): Promise<IgnoreResult> => {
      const row = await lockAndReadRow(tx, input.rowId);
      if (row === null) return failure("NOT_FOUND");
      if (row.state !== "QUEUED" || row.creditPaise <= 0n) return failure("NOT_QUEUED");
      if (row.version !== input.expectedVersion) return failure("STALE");
      const threshold = await approvalThreshold(tx);
      if (row.creditPaise >= threshold) {
        await tx.paymentMatch.create({ data: { bankRowId: row.id, decision: "REQUEST_APPROVAL", decidedById: input.user.id, reason: reason.data, reasons: { action: "IGNORE" } } });
        await tx.bankRow.update({ where: { id: row.id }, data: { state: "AWAITING_APPROVAL", version: { increment: 1 } }, select: { id: true } });
        await audit(tx, { actorId: input.user.id, action: "IGNORE_APPROVAL_REQUESTED", entityId: row.id, detail: { bankRowId: row.id, amountPaise: row.creditPaise.toString(), thresholdPaise: threshold.toString() }, now: input.now });
        return { status: "AWAITING_APPROVAL", thresholdPaise: threshold.toString() };
      }
      await tx.paymentMatch.create({ data: { bankRowId: row.id, decision: "IGNORE", decidedById: input.user.id, reason: reason.data } });
      await tx.bankRow.update({ where: { id: row.id }, data: { state: "IGNORED", version: { increment: 1 } }, select: { id: true } });
      await resolveQueueItem(tx, { rowId: row.id, userId: input.user.id, note: reason.data, now: input.now });
      await audit(tx, { actorId: input.user.id, action: "ROW_IGNORED", entityId: row.id, detail: { bankRowId: row.id, amountPaise: row.creditPaise.toString() }, now: input.now });
      return { status: "IGNORED" };
    },
    { timeout: 30_000, maxWait: 10_000 },
  ), TRANSACTION_RETRY);
}

export type ApproveResult =
  | { status: "APPROVED"; action: "IGNORE" }
  | { status: "APPROVED"; action: "MATCH"; flatCode: string; entries: { entryType: string; amountPaise: string }[]; payerNotice: PayerNotice | null; remaining: RemainingAfter }
  | ManualFailure;

/**
 * A second person approves a request (D14). The approver must hold payments:approve and must NOT be the person who asked
 * (SELF_APPROVAL, checked here before the database's own maker-checker constraint could fire). One transaction: the row is locked and
 * must be AWAITING_APPROVAL. For a match, the flat's oldest open position is read again UNDER THE BILL LOCK and checked against what
 * the requester saw (the bill and its amount due): if anything changed, nothing is posted, the row returns to QUEUED with a REJECTED
 * decision saying so, and the answer is STATE_CHANGED. Otherwise the requested action is performed exactly as a manual match or an
 * ignore, an APPROVED decision (decided_by the requester, approver_id the approver) is recorded and the queue item is RESOLVED.
 */
export async function approveRequest(input: { db: Db; user: ActingUser; rowId: string; note?: string; now: number }): Promise<ApproveResult> {
  if (!can(input.user, "payments:approve")) return failure("FORBIDDEN");
  if (!z.uuid().safeParse(input.rowId).success) return failure("NOT_FOUND");
  const written = (input.note ?? "").trim();
  const noteText = written === "" ? "Approved" : written;
  if (!reasonSchema.safeParse(noteText).success) return failure("REASON_REQUIRED");

  return withDeadlockRetry(() => input.db.$transaction(
    async (tx): Promise<ApproveResult> => {
      const row = await lockAndReadRow(tx, input.rowId);
      if (row === null) return failure("NOT_FOUND");
      if (row.state !== "AWAITING_APPROVAL") return failure("NOT_AWAITING_APPROVAL");
      const request = await tx.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id, decision: "REQUEST_APPROVAL" }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }] });
      const requesterId = request.decidedById as string;
      if (requesterId === input.user.id) return failure("SELF_APPROVAL");
      const action = requestedAction.safeParse(request.reasons);
      if (!action.success) throw new Error("A request for approval has no readable action");

      if (action.data.action === "IGNORE") {
        await tx.paymentMatch.create({ data: { bankRowId: row.id, decision: "APPROVED", decidedById: requesterId, approverId: input.user.id, reason: noteText } });
        await tx.bankRow.update({ where: { id: row.id }, data: { state: "IGNORED", version: { increment: 1 } }, select: { id: true } });
        await resolveQueueItem(tx, { rowId: row.id, userId: input.user.id, note: noteText, now: input.now });
        await audit(tx, { actorId: input.user.id, action: "IGNORE_APPROVED", entityId: row.id, detail: { bankRowId: row.id, requesterId, amountPaise: row.creditPaise.toString() }, now: input.now });
        return { status: "APPROVED", action: "IGNORE" };
      }

      const requested = action.data;
      const flat = await tx.flat.findUnique({ where: { code: requested.flatCode }, select: { id: true, code: true } });
      const plan = flat === null ? null : await planUnderLock(tx, { flatId: flat.id, creditPaise: row.creditPaise, txnDate: row.txnDate, policy: await loadPolicy(tx), expectedAmountDuePaise: BigInt(requested.amountDuePaise) });
      if (flat === null || plan === null || !plan.ok || plan.planned.billId !== requested.billId) {
        const why = plan !== null && !plan.ok ? plan.error : "the bill changed";
        await tx.paymentMatch.create({ data: { bankRowId: row.id, decision: "REJECTED", flatId: flat?.id ?? null, decidedById: input.user.id, reason: `State changed since the request (${why}): a person must look again` } });
        await tx.bankRow.update({ where: { id: row.id }, data: { state: "QUEUED", version: { increment: 1 } }, select: { id: true } });
        await audit(tx, { actorId: input.user.id, action: "MATCH_APPROVAL_STATE_CHANGED", entityId: row.id, detail: { bankRowId: row.id, requesterId, why }, now: input.now });
        return failure("STATE_CHANGED");
      }
      const posted = await postMatch(tx, {
        row,
        planned: plan.planned,
        flatCode: flat.code,
        userId: input.user.id,
        decision: { kind: "APPROVED", requesterId, approverId: input.user.id, reason: noteText },
        rememberPayer: requested.rememberPayer,
        auditAction: "MATCH_APPROVED",
        now: input.now,
      });
      return { status: "APPROVED", action: "MATCH", flatCode: flat.code, entries: posted.entries, payerNotice: posted.payerNotice, remaining: posted.remaining };
    },
    { timeout: 30_000, maxWait: 10_000 },
  ), TRANSACTION_RETRY);
}

export type RejectResult = { status: "REJECTED" } | ManualFailure;

/**
 * An approver turns a request down: the row returns to QUEUED with a REJECTED decision and the reason, and the queue item stays OPEN
 * for a person to decide again. Needs payments:approve and a reason of 5 to 500 characters.
 */
export async function rejectRequest(input: { db: Db; user: ActingUser; rowId: string; reason: string; now: number }): Promise<RejectResult> {
  if (!can(input.user, "payments:approve")) return failure("FORBIDDEN");
  if (!z.uuid().safeParse(input.rowId).success) return failure("NOT_FOUND");
  const reason = reasonSchema.safeParse(input.reason);
  if (!reason.success) return failure("REASON_REQUIRED");
  return withDeadlockRetry(() => input.db.$transaction(
    async (tx): Promise<RejectResult> => {
      const row = await lockAndReadRow(tx, input.rowId);
      if (row === null) return failure("NOT_FOUND");
      if (row.state !== "AWAITING_APPROVAL") return failure("NOT_AWAITING_APPROVAL");
      const request = await tx.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id, decision: "REQUEST_APPROVAL" }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }] });
      await tx.paymentMatch.create({ data: { bankRowId: row.id, decision: "REJECTED", flatId: request.flatId, decidedById: input.user.id, reason: reason.data } });
      await tx.bankRow.update({ where: { id: row.id }, data: { state: "QUEUED", version: { increment: 1 } }, select: { id: true } });
      await audit(tx, { actorId: input.user.id, action: "REQUEST_REJECTED", entityId: row.id, detail: { bankRowId: row.id, requesterId: request.decidedById, amountPaise: row.creditPaise.toString() }, now: input.now });
      return { status: "REJECTED" };
    },
    { timeout: 30_000, maxWait: 10_000 },
  ), TRANSACTION_RETRY);
}
