import { z } from "zod";
import type { PlannedEntry } from "@/domain/billing/posting";
import { planPosting } from "@/domain/billing/posting";
import type { LateFeePolicy } from "@/domain/billing/late-fee";
import type { CalendarDate } from "@/domain/time/calendar";
import type { SessionUser } from "@/server/auth/session-service";
import { calendarDateOf } from "@/server/home/mapper";
import { lockBill } from "@/server/payments/bill-lock";
import type { Prisma } from "../../../generated/prisma/client";
import { loadPositions, openOnly } from "./positions";
import { bankReferences } from "./reference";

export type Tx = Prisma.TransactionClient;

/** Who is acting. The route already checked the permission; the service checks it again (a second lock on the same door). */
export type ActingUser = Pick<SessionUser, "id" | "role" | "active" | "permissions">;

/** Why a manual action did not happen. The route maps each to a status (409, 422, 404, 403) and a fixed code. */
export type ManualError =
  | "NOT_FOUND"
  | "FLAT_NOT_FOUND"
  | "NOT_QUEUED"
  | "NOT_AWAITING_APPROVAL"
  | "STALE"
  | "STATE_CHANGED"
  | "SELF_APPROVAL"
  | "NO_OPEN_BILL"
  | "NEEDS_ADVANCE_HANDLING"
  | "REASON_REQUIRED"
  | "FORBIDDEN";

export type ManualFailure = { status: "ERROR"; error: ManualError };
export const failure = (error: ManualError): ManualFailure => ({ status: "ERROR", error });

/** A reason or note a person writes: 5 to 500 characters after trimming. */
export const reasonSchema = z.string().trim().min(5).max(500);

export type PayerNotice = "ADDED" | "ALREADY_KNOWN" | "VPA_ON_OTHER_FLAT";

export type RemainingAfter = { kind: "SETTLED" | "PRINCIPAL_OPEN" | "FEE_ONLY"; duePaise: string; /** Only when the principal is paid and the fee is owing. */ feeOwedPaise: string | null };

export type LockedRow = {
  id: string;
  importId: string;
  txnDate: CalendarDate;
  creditPaise: bigint;
  debitPaise: bigint;
  state: string;
  version: number;
  dedupeKey: string;
  parsed: unknown;
};

/** Takes the row's lock (`SELECT ... FOR UPDATE`) and reads it, so two people on one row take turns and the second sees what the first did. */
export async function lockAndReadRow(tx: Tx, rowId: string): Promise<LockedRow | null> {
  const found = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM bank_rows WHERE id = ${rowId}::uuid FOR UPDATE`;
  if (found.length === 0) return null;
  const row = await tx.bankRow.findUniqueOrThrow({ where: { id: rowId } });
  return { id: row.id, importId: row.importId, txnDate: calendarDateOf(row.txnDate), creditPaise: row.creditPaise, debitPaise: row.debitPaise, state: row.state, version: row.version, dedupeKey: row.dedupeKey, parsed: row.parsed };
}

/** society_settings approval_threshold_paise: a credit at or above it needs a second approver (D14). A missing or invalid setting throws. */
export async function approvalThreshold(tx: Tx): Promise<bigint> {
  const setting = await tx.societySetting.findUnique({ where: { key: "approval_threshold_paise" }, select: { value: true } });
  const parsed = z.number().int().positive().safeParse(setting?.value);
  if (!parsed.success) throw new Error("The approval_threshold_paise setting is missing or not valid");
  return BigInt(parsed.data);
}

export type Planned = {
  flatId: string;
  billId: string;
  /** The amount due on the oldest open position, as of the row's date: what a reviewer saw and what an approval is checked against. */
  amountDuePaise: bigint;
  principalOutstandingPaise: bigint;
  kind: "PRINCIPAL_OPEN" | "FEE_ONLY";
  entries: PlannedEntry[];
};

/**
 * The entries a credit would post on a flat, worked out UNDER THE BILL LOCK from a fresh read of the flat's ledger (D104, D107):
 * the flat's OLDEST open position as of the row's date, then `planPosting`. The oldest position is read, its bill locked and the
 * ledger read again; if the oldest changed meanwhile the new one is locked and read again. A NO_DUES refusal is NO_OPEN_BILL and an
 * EXCESS is NEEDS_ADVANCE_HANDLING (advances and several bills in one payment are not supported). A live payment on the bill dated
 * after the row is STATE_CHANGED: the order of payments needs a person's eye, as in the matcher (LATER_PAYMENT). The lock is held to
 * the end of the transaction.
 */
export async function planUnderLock(
  tx: Tx,
  input: { flatId: string; creditPaise: bigint; txnDate: CalendarDate; policy: LateFeePolicy; expectedAmountDuePaise?: bigint },
): Promise<{ ok: true; planned: Planned } | { ok: false; error: ManualError }> {
  let locked: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const open = openOnly((await loadPositions(tx, [input.flatId], input.txnDate, input.policy)).get(input.flatId) ?? []);
    const oldest = open[0];
    if (oldest === undefined) return { ok: false, error: "NO_OPEN_BILL" };
    if (locked !== oldest.bill.id) {
      await lockBill(tx, oldest.bill.id);
      locked = oldest.bill.id;
      continue;
    }
    if (input.expectedAmountDuePaise !== undefined && input.expectedAmountDuePaise !== oldest.position.amountDuePaise) return { ok: false, error: "STATE_CHANGED" };
    const later = await tx.ledgerEntry.findMany({ where: { billId: oldest.bill.id, entryType: "PAYMENT", effectiveDate: { gt: new Date(`${input.txnDate}T00:00:00.000Z`) } }, select: { id: true } });
    if (later.length > 0) {
      const reversed = await tx.ledgerEntry.count({ where: { entryType: "REVERSAL", reversesEntryId: { in: later.map((l) => l.id) } } });
      if (reversed < later.length) return { ok: false, error: "STATE_CHANGED" };
    }
    const plan = planPosting({ position: oldest.position, creditPaise: input.creditPaise, paymentDate: input.txnDate });
    if ("refused" in plan) return { ok: false, error: plan.refused === "NO_DUES" ? "NO_OPEN_BILL" : "NEEDS_ADVANCE_HANDLING" };
    return {
      ok: true,
      planned: {
        flatId: input.flatId,
        billId: oldest.bill.id,
        amountDuePaise: oldest.position.amountDuePaise,
        principalOutstandingPaise: oldest.position.principalOutstandingPaise,
        kind: oldest.position.kind === "FEE_ONLY" ? "FEE_ONLY" : "PRINCIPAL_OPEN",
        entries: plan.entries,
      },
    };
  }
  return { ok: false, error: "STATE_CHANGED" };
}

/** What is left on the bill after the credit: the same arithmetic planPosting is tested against (amount due after = before - credit). */
export function remainingAfter(planned: Planned, creditPaise: bigint): RemainingAfter {
  const due = planned.amountDuePaise - creditPaise;
  if (due === 0n) return { kind: "SETTLED", duePaise: "0", feeOwedPaise: null };
  const principalPaid = planned.kind === "FEE_ONLY" || creditPaise >= planned.principalOutstandingPaise;
  return principalPaid ? { kind: "FEE_ONLY", duePaise: due.toString(), feeOwedPaise: due.toString() } : { kind: "PRINCIPAL_OPEN", duePaise: due.toString(), feeOwedPaise: null };
}

export async function audit(tx: Tx, input: { actorId: string; action: string; entityId: string; detail: Record<string, unknown>; now: number }): Promise<void> {
  await tx.auditLog.create({
    data: { actorId: input.actorId, action: input.action, entityType: "bank_row", entityId: input.entityId, detail: JSON.parse(JSON.stringify(input.detail)) as Prisma.InputJsonValue, createdAt: new Date(input.now) },
  });
}

/** Resolves the OPEN queue item of a bank row (RESOLVED, when, who, why). */
export async function resolveQueueItem(tx: Tx, input: { rowId: string; userId: string; note: string; now: number }): Promise<void> {
  await tx.accountsQueueItem.updateMany({ where: { bankRowId: input.rowId, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date(input.now), resolvedById: input.userId, note: input.note } });
}

/**
 * Remembers the payer's UPI id for the flat (source MANUAL) once. An id registered to ANOTHER flat is never added: the notice says so.
 * Only call it when money was actually posted or approved.
 */
export async function rememberUpiPayer(tx: Tx, input: { vpa: string | null; flatId: string; userId: string }): Promise<PayerNotice | null> {
  if (input.vpa === null) return null;
  const known = await tx.knownPayer.findMany({ where: { identifierType: "UPI_ID", identifierValue: { equals: input.vpa, mode: "insensitive" } }, select: { flatId: true } });
  if (known.some((k) => k.flatId !== input.flatId)) return "VPA_ON_OTHER_FLAT";
  if (known.length > 0) return "ALREADY_KNOWN";
  await tx.knownPayer.create({ data: { flatId: input.flatId, identifierType: "UPI_ID", identifierValue: input.vpa, source: "MANUAL", addedById: input.userId } });
  return "ADDED";
}

export const parsedVpa = (parsed: unknown): string | null => {
  const vpa = (parsed as { vpa?: unknown } | null)?.vpa;
  return typeof vpa === "string" && vpa.trim() !== "" ? vpa.trim().toLowerCase() : null;
};
const parsedRail = (parsed: unknown): { rail: string; reference: string | null } => {
  const p = (parsed ?? {}) as { rail?: unknown; reference?: unknown };
  return { rail: typeof p.rail === "string" ? p.rail : "UNKNOWN", reference: typeof p.reference === "string" ? p.reference : null };
};

export type PostInput = {
  row: LockedRow;
  planned: Planned;
  flatCode: string;
  /** The person who writes the ledger entries and, for a manual match, decides. */
  userId: string;
  decision: { kind: "MANUAL"; reason: string } | { kind: "APPROVED"; requesterId: string; approverId: string; reason: string };
  rememberPayer: boolean;
  auditAction: string;
  now: number;
};

export type PostedMatch = { ledgerEntryIds: string[]; entries: { entryType: string; amountPaise: string }[]; paymentEntryId: string; payerNotice: PayerNotice | null; remaining: RemainingAfter };

/**
 * Writes a match: the planned entries (a LATE_FEE when planned, then ONE PAYMENT carrying the bank row), the row MANUALLY_MATCHED, the
 * decision row, the resolved queue item, the payer if asked, and the audit row. The caller holds the row lock and the bill lock and
 * runs this in the same transaction. Entries are dated the row's date, keyed `manual:<rowId>:<TYPE>`, and the PAYMENT's reference is
 * the D106 reference (no narration text).
 */
export async function postMatch(tx: Tx, input: PostInput): Promise<PostedMatch> {
  const { row, planned } = input;
  const references = await bankReferences(tx, [{ key: row.id, source: { ...parsedRail(row.parsed), dedupeKey: row.dedupeKey } }]);
  const ids: string[] = [];
  let paymentEntryId = "";
  for (const entry of planned.entries) {
    const isPayment = entry.entryType === "PAYMENT";
    const created = await tx.ledgerEntry.create({
      data: {
        flatId: planned.flatId,
        billId: planned.billId,
        entryType: entry.entryType,
        direction: entry.direction,
        amountPaise: entry.amountPaise,
        effectiveDate: new Date(`${entry.effectiveDate}T00:00:00.000Z`),
        bankRowId: isPayment ? row.id : null,
        reference: isPayment ? (references.get(row.id) as string) : null,
        idempotencyKey: `manual:${row.id}:${entry.entryType}`,
        createdById: input.userId,
      },
      select: { id: true },
    });
    ids.push(created.id);
    if (isPayment) paymentEntryId = created.id;
  }
  await tx.bankRow.update({ where: { id: row.id }, data: { state: "MANUALLY_MATCHED", flatId: planned.flatId, ledgerEntryId: paymentEntryId, version: { increment: 1 } }, select: { id: true } });
  const decision = input.decision;
  await tx.paymentMatch.create({
    data:
      decision.kind === "MANUAL"
        ? { bankRowId: row.id, decision: "MANUAL", flatId: planned.flatId, decidedById: input.userId, reason: decision.reason }
        : { bankRowId: row.id, decision: "APPROVED", flatId: planned.flatId, decidedById: decision.requesterId, approverId: decision.approverId, reason: decision.reason },
  });
  await resolveQueueItem(tx, { rowId: row.id, userId: input.userId, note: decision.reason, now: input.now });
  const payerNotice = input.rememberPayer ? await rememberUpiPayer(tx, { vpa: parsedVpa(row.parsed), flatId: planned.flatId, userId: input.userId }) : null;
  const credit = row.creditPaise;
  await audit(tx, {
    actorId: input.userId,
    action: input.auditAction,
    entityId: row.id,
    detail: { bankRowId: row.id, flatCode: input.flatCode, billId: planned.billId, ledgerEntryIds: ids, amountPaise: credit.toString(), payerNotice },
    now: input.now,
  });
  return {
    ledgerEntryIds: ids,
    entries: planned.entries.map((e) => ({ entryType: e.entryType, amountPaise: e.amountPaise.toString() })),
    paymentEntryId,
    payerNotice,
    remaining: remainingAfter(planned, credit),
  };
}
