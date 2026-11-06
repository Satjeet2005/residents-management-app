import { z } from "zod";
import { can } from "@/domain/auth/permissions";
import type { Db } from "@/server/auth/db";
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
} from "./manual-core";
import { loadPolicy } from "./positions";

export type MatchResult =
  | {
      status: "POSTED";
      flatCode: string;
      entries: { entryType: string; amountPaise: string }[];
      payerNotice: PayerNotice | null;
      /** What is left on the bill: SETTLED, still PRINCIPAL_OPEN, or FEE_ONLY with the fee still owing. */
      remaining: RemainingAfter;
    }
  | { status: "AWAITING_APPROVAL"; thresholdPaise: string }
  | ManualFailure;

const inputSchema = z.object({ flatCode: z.string().trim().min(3).max(20), reason: reasonSchema, rememberPayer: z.boolean(), expectedVersion: z.number().int().min(1) });

/**
 * Staff match a QUEUED bank row to a flat by hand (D7, D14, D107, D110). ONE transaction:
 *  1. the row is locked and must be QUEUED with a credit (else NOT_QUEUED) at `expectedVersion` (else STALE); a reason of 5 to 500
 *     characters is required (REASON_REQUIRED);
 *  2. under the bill lock, from a fresh read of the flat's ledger, the flat's OLDEST open position as of the row's date is taken and
 *     `planPosting` plans the entries: NO_DUES is NO_OPEN_BILL and EXCESS is NEEDS_ADVANCE_HANDLING. If `expectedAmountDuePaise` (what
 *     the reviewer saw) is given and the amount due is now different, nothing is posted: STATE_CHANGED;
 *  3. a credit at or above society_settings approval_threshold_paise is not posted: the row becomes AWAITING_APPROVAL, a REQUEST_APPROVAL
 *     decision records the request and the queue item stays OPEN;
 *  4. below it the entries are written (a LATE_FEE when planned, then ONE PAYMENT carrying the bank row), the row is MANUALLY_MATCHED, a
 *     MANUAL decision is recorded and the queue item is RESOLVED with the reason. `rememberPayer` adds the UPI id as a known payer, once,
 *     never when it belongs to another flat (a notice says so).
 * No narration text is written to the audit log.
 */
export async function postManualMatch(input: {
  db: Db;
  user: ActingUser;
  rowId: string;
  flatCode: string;
  reason: string;
  rememberPayer: boolean;
  expectedVersion: number;
  expectedAmountDuePaise?: bigint;
  now: number;
}): Promise<MatchResult> {
  if (!can(input.user, "payments:match")) return failure("FORBIDDEN");
  if (!z.uuid().safeParse(input.rowId).success) return failure("NOT_FOUND");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues.some((i) => i.path[0] === "reason") ? "REASON_REQUIRED" : "FLAT_NOT_FOUND");
  const { flatCode, reason, rememberPayer, expectedVersion } = parsed.data;

  return input.db.$transaction(
    async (tx): Promise<MatchResult> => {
      const row = await lockAndReadRow(tx, input.rowId);
      if (row === null) return failure("NOT_FOUND");
      if (row.state !== "QUEUED" || row.creditPaise <= 0n) return failure("NOT_QUEUED");
      if (row.version !== expectedVersion) return failure("STALE");
      const flat = await tx.flat.findUnique({ where: { code: flatCode.toUpperCase() }, select: { id: true, code: true } });
      if (flat === null) return failure("FLAT_NOT_FOUND");

      const policy = await loadPolicy(tx);
      const plan = await planUnderLock(tx, { flatId: flat.id, creditPaise: row.creditPaise, txnDate: row.txnDate, policy, expectedAmountDuePaise: input.expectedAmountDuePaise });
      if (!plan.ok) return failure(plan.error);

      const threshold = await approvalThreshold(tx);
      if (row.creditPaise >= threshold) {
        await tx.paymentMatch.create({
          data: {
            bankRowId: row.id,
            decision: "REQUEST_APPROVAL",
            flatId: flat.id,
            decidedById: input.user.id,
            reason,
            reasons: { action: "MATCH", flatCode: flat.code, rememberPayer, billId: plan.planned.billId, amountDuePaise: plan.planned.amountDuePaise.toString() },
          },
        });
        await tx.bankRow.update({ where: { id: row.id }, data: { state: "AWAITING_APPROVAL", version: { increment: 1 } }, select: { id: true } });
        await audit(tx, { actorId: input.user.id, action: "MATCH_APPROVAL_REQUESTED", entityId: row.id, detail: { bankRowId: row.id, flatCode: flat.code, amountPaise: row.creditPaise.toString(), thresholdPaise: threshold.toString() }, now: input.now });
        return { status: "AWAITING_APPROVAL", thresholdPaise: threshold.toString() };
      }

      const posted = await postMatch(tx, { row, planned: plan.planned, flatCode: flat.code, userId: input.user.id, decision: { kind: "MANUAL", reason }, rememberPayer, auditAction: "MANUAL_MATCH_POSTED", now: input.now });
      return { status: "POSTED", flatCode: flat.code, entries: posted.entries, payerNotice: posted.payerNotice, remaining: posted.remaining };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
