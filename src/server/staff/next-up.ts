import { Prisma } from "../../../generated/prisma/client";
import { type SlaState, slaState } from "@/domain/complaints/lifecycle";
import type { Urgency } from "@/domain/complaints/taxonomy";
import type { Confidence } from "@/lib/reconciliation/types";
import { NEXT_UP_MAX } from "@/lib/staff-home";
import type { Db } from "@/server/auth/db";
import { ACKED, ACKS, listBoardView } from "@/server/complaints/board-views";
import type { Actor } from "@/server/complaints/context";
import { calendarDateOf, complaintTitle } from "@/server/home/mapper";

export type NextUpPayment = {
  id: string;
  importId: string;
  amountPaise: string;
  txnDate: string;
  direction: "CREDIT" | "DEBIT";
  /** The lane the row is in: a request from someone else waits for this person's approval; the rest need a person. */
  lane: "AWAITING_APPROVAL" | "NEEDS_YOU";
  bestFlat: string | null;
  confidence: Confidence | null;
  needsSecondApprover: boolean;
};

export type NextUpComplaint = { id: string; title: string; flatCode: string; category: string | null; urgency: Urgency; safety: boolean; responseDueAt: number | null; sla: SlaState };

type Viewer = Pick<Actor, "id" | "role" | "active" | "permissions">;
const CONFIDENCES: readonly string[] = ["HIGH", "MEDIUM", "LOW", "NONE"];

type PaymentSqlRow = { id: string; import_id: string; txn_date: Date; amount: bigint; credit: boolean; state: string; parsed: { decision?: { confidence?: string; candidates?: { flatCode?: string }[] } } | null; threshold: bigint | null };

/**
 * The payments a person should look at next, over ALL imports, at most three, by one SELECT. An approver gets the requests that someone ELSE made first (a request
 * they made themselves is never shown to them), then the rows that need a person; each group biggest amount first, the newest import first on a tie, then the id.
 */
export async function loadNextUpPayments({ db, user, approver }: { db: Db; user: Viewer; approver: boolean }): Promise<NextUpPayment[]> {
  const awaiting = approver
    ? Prisma.sql`OR (r.state = 'AWAITING_APPROVAL' AND (SELECT m.decided_by_id FROM payment_matches m WHERE m.bank_row_id = r.id AND m.decision = 'REQUEST_APPROVAL' ORDER BY m.decided_at DESC, m.id DESC LIMIT 1) IS DISTINCT FROM ${user.id}::uuid)`
    : Prisma.empty;
  const rows = await db.$queryRaw<PaymentSqlRow[]>`
    SELECT r.id::text AS id, r.import_id::text AS import_id, r.txn_date, GREATEST(r.credit_paise, r.debit_paise) AS amount, (r.credit_paise > 0) AS credit, r.state::text AS state, r.parsed,
      (SELECT (s.value #>> '{}')::bigint FROM society_settings s WHERE s.key = 'approval_threshold_paise') AS threshold
    FROM bank_rows r JOIN statement_imports i ON i.id = r.import_id
    WHERE r.state = 'QUEUED' ${awaiting}
    ORDER BY (r.state = 'AWAITING_APPROVAL') DESC, amount DESC, i.uploaded_at DESC, r.id
    LIMIT ${NEXT_UP_MAX}`;
  return rows.map((r) => {
    const decision = r.parsed?.decision;
    const confidence = decision?.confidence;
    return {
      id: r.id,
      importId: r.import_id,
      amountPaise: r.amount.toString(),
      txnDate: calendarDateOf(r.txn_date),
      direction: r.credit ? "CREDIT" : "DEBIT",
      lane: r.state === "AWAITING_APPROVAL" ? "AWAITING_APPROVAL" : "NEEDS_YOU",
      bestFlat: decision?.candidates?.[0]?.flatCode ?? null,
      confidence: confidence !== undefined && CONFIDENCES.includes(confidence) ? (confidence as Confidence) : null,
      needsSecondApprover: r.credit && r.threshold !== null && r.amount >= r.threshold,
    };
  });
}

type ComplaintSqlRow = { id: string; body: string; flat_code: string; category: string | null; urgency: Urgency; status: string; response_due_at: Date | null; first_response_at: Date | null };

/** The open safety complaints the duty manager has not acknowledged, oldest first, at most `limit`: the first thing on the duty manager's list. */
async function unseenSafety(db: Db, limit: number, now: number): Promise<NextUpComplaint[]> {
  const rows = await db.$queryRaw<ComplaintSqlRow[]>`
    SELECT c.id::text AS id, c.body, f.code AS flat_code, cat.code AS category, c.urgency::text AS urgency, c.status::text AS status, c.response_due_at, c.first_response_at
    FROM complaints c ${ACKS} JOIN flats f ON f.id = c.flat_id LEFT JOIN complaint_categories cat ON cat.id = c.category_id
    WHERE c.status <> 'CLOSED' AND c.safety_flag AND NOT ${ACKED}
    ORDER BY c.created_at ASC, c.id
    LIMIT ${limit}`;
  return rows.map((r) => {
    const responseDueAt = r.response_due_at?.getTime() ?? null;
    return {
      id: r.id,
      title: complaintTitle(r.body),
      flatCode: r.flat_code,
      category: r.category,
      urgency: r.urgency,
      safety: true,
      responseDueAt,
      sla: slaState({ status: r.status as Parameters<typeof slaState>[0]["status"], responseDueAt, firstResponseAt: r.first_response_at?.getTime() ?? null, now }),
    };
  });
}

/**
 * The complaints a person should open next, at most three: the duty manager's unseen safety complaints first (oldest first), then the board's own "Needs action"
 * order. A failure of the board read is thrown to the caller, which shows the section without rows.
 */
export async function loadNextUpComplaints({ db, user, now, duty }: { db: Db; user: Viewer; now: number; duty: boolean }): Promise<NextUpComplaint[]> {
  const safety = duty ? await unseenSafety(db, NEXT_UP_MAX, now) : [];
  if (safety.length >= NEXT_UP_MAX) return safety;
  const board = await listBoardView({ db, user: { ...user, name: "" }, view: "needs_action", limit: NEXT_UP_MAX, now });
  if (board.status !== "OK") throw new Error(`The board answered ${board.status}`);
  const seen = new Set(safety.map((s) => s.id));
  const rest = board.rows
    .filter((row) => !seen.has(row.id))
    .map((row): NextUpComplaint => ({ id: row.id, title: row.title, flatCode: row.flatCode, category: row.category, urgency: row.urgency, safety: row.safety, responseDueAt: row.responseDueAt, sla: row.sla }));
  return [...safety, ...rest].slice(0, NEXT_UP_MAX);
}
