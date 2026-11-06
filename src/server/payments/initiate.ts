import { lockAmount } from "@/domain/payments/amount-lock";
import type { Paise } from "@/domain/money/money";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { findCurrentMemberships, loadBills, loadEntries, loadSettings } from "@/server/home/queries";
import { parsePolicy, toDueBill, toDueEntry } from "@/server/home/mapper";
import { type PaymentGateway, MockGateway } from "./gateway";

export type InitiateResult =
  | { status: "CREATED" | "EXISTING"; attemptId: string; checkoutPath: string; amountPaise: Paise }
  /** The amount the person saw is not today's amount (for example the date moved on): show this one and let them tap again. */
  | { status: "AMOUNT_CHANGED"; amountPaise: Paise }
  | { status: "NO_DUES" };

/** Prisma reports a unique-index violation as P2002, and the driver adapter as SQLSTATE 23505; either, or the index name, counts. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const text = `${String(e.message ?? "")} ${JSON.stringify(e.meta ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v))} ${JSON.stringify(e.cause ?? {}, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`;
  return e.code === "P2002" || /23505|unique constraint|payment_attempts_one_unresolved_per_bill/i.test(text);
}

type Attempt = { id: string; amountPaise: bigint; gatewayReference: string | null };

const UNRESOLVED = ["INITIATED", "PROCESSING"] as const;

/**
 * Starts a payment (D99, D101). The amount is locked here, when Pay is tapped: the OLDEST open bill's outstanding principal
 * plus its late fee on the business date, worked out by the same function as the Home. The flat is the person's own current
 * flat (the Home's rule); nothing from the request chooses a flat or a bill.
 *
 * - The amount the person saw is `expectedAmountPaise`. If today's amount differs (the date rolled over, or a payment
 *   landed) the answer is AMOUNT_CHANGED with the new amount, and nothing is created.
 * - One unresolved attempt per bill (a database index, D40): a second tap, a retry or a concurrent request gets the
 *   attempt that already exists, unchanged. The loser of a race catches the index violation and loads the winner.
 * - The attempt (INITIATED, amount locked, gateway reference set, started now) and its audit row are written in one transaction.
 */
export async function initiatePayment(input: {
  db: Db;
  user: Pick<SessionUser, "id">;
  expectedAmountPaise: Paise;
  now: number;
  gateway?: PaymentGateway;
}): Promise<InitiateResult> {
  const { db, user, now } = input;
  const gateway = input.gateway ?? new MockGateway();
  const today = istDateOf(now);

  const memberships = (await findCurrentMemberships(db, user.id, today)).sort((a, b) => (a.flatCode < b.flatCode ? -1 : a.flatCode > b.flatCode ? 1 : 0));
  const flat = memberships[0];
  if (flat === undefined) return { status: "NO_DUES" };
  const [bills, entries, settings] = await Promise.all([loadBills(db, flat.flatId), loadEntries(db, flat.flatId), loadSettings(db)]);
  const locked = lockAmount({
    openBills: bills.map(toDueBill),
    asOf: today,
    policy: parsePolicy(settings),
    payments: entries.filter((e) => e.entryType === "PAYMENT" || e.entryType === "REVERSAL").map(toDueEntry),
  });
  if (locked === null) return { status: "NO_DUES" };
  if (locked.totalPaise !== input.expectedAmountPaise) return { status: "AMOUNT_CHANGED", amountPaise: locked.totalPaise };

  const describe = (attempt: Attempt, status: "CREATED" | "EXISTING"): InitiateResult => ({
    status,
    attemptId: attempt.id,
    checkoutPath: gateway.createCheckout({ id: attempt.id }).checkoutPath,
    amountPaise: attempt.amountPaise,
  });
  const findUnresolved = (): Promise<Attempt | null> =>
    db.paymentAttempt.findFirst({ where: { billId: locked.billId, status: { in: [...UNRESOLVED] } }, select: { id: true, amountPaise: true, gatewayReference: true } });

  const existing = await findUnresolved();
  if (existing !== null) return describe(existing, "EXISTING");

  const id = crypto.randomUUID();
  const { reference } = gateway.createCheckout({ id });
  try {
    const created = await db.$transaction(async (tx) => {
      const attempt = await tx.paymentAttempt.create({
        data: { id, billId: locked.billId, flatId: flat.flatId, amountPaise: locked.totalPaise, status: "INITIATED", gatewayReference: reference, startedAt: new Date(now) },
        select: { id: true, amountPaise: true, gatewayReference: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "PAYMENT_STARTED",
          entityType: "payment_attempt",
          entityId: id,
          detail: { attemptId: id, billId: locked.billId, amountPaise: locked.totalPaise.toString() },
          createdAt: new Date(now),
        },
      });
      return attempt;
    });
    return describe(created, "CREATED");
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findUnresolved();
    if (winner === null) throw error;
    return describe(winner, "EXISTING");
  }
}
