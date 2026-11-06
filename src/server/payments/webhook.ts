import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { positionsForFlat } from "@/domain/billing/dues";
import { type ExceptionReason, type GatewayAttempt, decideGatewayEvent, describeException } from "@/domain/payments/attempt-state";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRIES, withDeadlockRetry } from "@/server/db-retry";
import { parsePolicy, toDueBill, toDueEntry } from "@/server/home/mapper";
import { lockBill } from "./bill-lock";

const MIN_SECRET_LENGTH = 32;
/** The placeholder in .env.example: long enough to pass a length check, so it is named and refused in production. */
const PLACEHOLDER_PREFIX = "replace-with";
/** A signed request older or newer than this many seconds is refused, so a captured request cannot be replayed later. */
export const TIMESTAMP_WINDOW_SECONDS = 300;

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The secret fails closed: missing is always an error, and in production a secret under 32 characters or the placeholder is
 * too. The error never contains the value. The route turns a throw into a plain 500 and nothing is processed.
 */
function checkedSecret(secret: string | undefined, env: Env): string {
  const value = secret ?? "";
  if (value === "") throw new Error("PAYMENT_WEBHOOK_SECRET is not set");
  if (env.NODE_ENV === "production" && (value.length < MIN_SECRET_LENGTH || value.startsWith(PLACEHOLDER_PREFIX))) {
    throw new Error(`PAYMENT_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters and not the placeholder in production`);
  }
  return value;
}

const sign = (secret: string, timestamp: string, rawBody: string): string => createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

/** The two headers of a signed event: the time in seconds, and the hex HMAC-SHA256 of `${timestamp}.${rawBody}`. */
export function signWebhook(rawBody: string, secret: string, nowMs: number, env: Env = process.env): { "x-timestamp": string; "x-signature": string } {
  const timestamp = String(Math.floor(nowMs / 1000));
  return { "x-timestamp": timestamp, "x-signature": sign(checkedSecret(secret, env), timestamp, rawBody) };
}

const bodySchema = z.object({
  eventId: z.string().min(1).max(100),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  reference: z.string().min(1).max(200),
  amountPaise: z.string().regex(/^[0-9]{1,15}$/),
});

export type WebhookEvent = { eventId: string; type: "payment.succeeded" | "payment.failed"; reference: string; amountPaise: bigint };

export type Verification = { kind: "OK"; event: WebhookEvent } | { kind: "BAD_SIGNATURE" } | { kind: "BAD_BODY" };

/**
 * Checks a webhook request. In order: the timestamp is whole seconds within 300 seconds of `now`; the signature is a hex
 * HMAC-SHA256 of `${timestamp}.${rawBody}` under the secret, compared in constant time; only then is the body read and
 * validated (a bad body is BAD_BODY, never confused with a bad signature). Anything wrong with the headers is BAD_SIGNATURE,
 * with no detail about which part. Throws if the secret is missing or, in production, weak (fail closed).
 */
export function verifyWebhook(rawBody: string, headers: Pick<Headers, "get">, secret: string | undefined, now: number, env: Env = process.env): Verification {
  const key = checkedSecret(secret, env);
  const timestamp = headers.get("x-timestamp")?.trim() ?? "";
  const signature = headers.get("x-signature")?.trim().toLowerCase() ?? "";
  if (!/^[0-9]{1,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return { kind: "BAD_SIGNATURE" };
  if (Math.abs(now / 1000 - Number(timestamp)) > TIMESTAMP_WINDOW_SECONDS) return { kind: "BAD_SIGNATURE" };
  const expected = Buffer.from(sign(key, timestamp, rawBody), "hex");
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return { kind: "BAD_SIGNATURE" };

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { kind: "BAD_BODY" };
  }
  const parsed = bodySchema.safeParse(value);
  if (!parsed.success) return { kind: "BAD_BODY" };
  return { kind: "OK", event: { ...parsed.data, amountPaise: BigInt(parsed.data.amountPaise) } };
}

export type ApplyOutcome =
  | { outcome: "POSTED" }
  | { outcome: "FAILED_MARKED" }
  | { outcome: "DUPLICATE" }
  | { outcome: "EXCEPTION"; reason: ExceptionReason };

type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

async function audit(tx: Tx, action: string, entityId: string, detail: Record<string, string>, now: number): Promise<void> {
  await tx.auditLog.create({ data: { actorId: null, action, entityType: "payment_attempt", entityId, detail, createdAt: new Date(now) } });
}

/** An EXCEPTION for a person at accounts: one queue item per attempt while one is open, the attempt itself untouched. */
async function queueException(tx: Tx, attemptId: string, reason: ExceptionReason, now: number): Promise<void> {
  const open = await tx.accountsQueueItem.findFirst({ where: { paymentAttemptId: attemptId, status: "OPEN" }, select: { id: true } });
  if (open === null) {
    await tx.accountsQueueItem.create({ data: { itemType: "EXCEPTION", paymentAttemptId: attemptId, note: describeException(reason), openedAt: new Date(now) } });
  }
}

/**
 * Applies one verified gateway event (D45, D50, D107). Everything happens in ONE transaction, and the first statement locks the
 * attempt's row (`SELECT ... FOR UPDATE`), so two events for the same attempt run one after the other: the second sees what the
 * first did and is a DUPLICATE, never a second posting. It then takes the bill's lock (`lockBill`, shared with the bank statement
 * import, D104), so a bank posting and a gateway success cannot both pay one bill: whichever is second sees the first one's payment
 * and becomes an exception. The decision is `decideGatewayEvent`; this function only loads the facts and writes the answer.
 * - POST: the entries planPosting plans (a LATE_FEE once when the principal is reached, and ONE PAYMENT; a PAYMENT alone for a fee-only bill), the attempt SUCCEEDED with debit CONFIRMED and resolved_at.
 * - MARK_FAILED: the attempt FAILED with debit NOT_DEBITED and resolved_at; nothing is posted.
 * - DUPLICATE: nothing changes.
 * - EXCEPTION: one OPEN queue item (skipped if one is open), the attempt left as it is, nothing posted.
 * - An unknown reference: nothing is posted; an audit row is written and the caller still answers 200 (a gateway cannot probe).
 * Every outcome writes an audit row. `now` is the real clock.
 */
export async function applyGatewayEvent(db: Db, event: WebhookEvent, now: number): Promise<ApplyOutcome | { outcome: "UNKNOWN_REFERENCE" }> {
  return withDeadlockRetry(() => db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM payment_attempts WHERE gateway_reference = ${event.reference} FOR UPDATE`;
    if (locked.length === 0) {
      await audit(tx, "PAYMENT_EXCEPTION", "unknown", { reason: "UNKNOWN_REFERENCE", eventId: event.eventId, reference: event.reference }, now);
      return { outcome: "UNKNOWN_REFERENCE" } as const;
    }
    const row = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: locked[0].id }, include: { bill: true } });
    // The bank import takes the same lock before it posts to a bill (D104): after it, what is read below is the bill's final state.
    await lockBill(tx, row.billId);
    const startedOn = istDateOf(row.startedAt.getTime());
    const attempt: GatewayAttempt = { id: row.id, billId: row.billId, flatId: row.flatId, status: row.status, amountPaise: row.amountPaise, reference: row.gatewayReference ?? "", startedOn };

    const [entries, settings] = await Promise.all([
      tx.ledgerEntry.findMany({
        where: { flatId: row.flatId, entryType: { in: ["PAYMENT", "REVERSAL", "LATE_FEE", "ADJUSTMENT"] } },
        select: { id: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true },
      }),
      tx.societySetting.findMany({ where: { key: "late_fee_policy" }, select: { key: true, value: true } }),
    ]);
    const payments = entries.map(toDueEntry);
    const reversed = new Set(payments.filter((e) => e.entryType === "REVERSAL").map((e) => e.reversesEntryId));
    const position = positionsForFlat({ bills: [toDueBill(row.bill)], entries: payments, policy: parsePolicy(settings), asOf: startedOn })[0]?.position ?? null;
    const decision = decideGatewayEvent({
      attempt,
      event: { type: event.type === "payment.succeeded" ? "SUCCEEDED" : "FAILED", amountPaise: event.amountPaise, reference: event.reference },
      bill: {
        position,
        hasPaymentAfterStart: payments.some((e) => e.entryType === "PAYMENT" && e.billId === row.billId && e.effectiveDate > startedOn && !reversed.has(e.id)),
      },
    });
    const detail = { eventId: event.eventId, reference: event.reference, amountPaise: event.amountPaise.toString() };

    switch (decision.kind) {
      case "POST": {
        for (const entry of decision.entries) {
          await tx.ledgerEntry.create({
            data: {
              flatId: entry.flatId,
              billId: entry.billId,
              paymentAttemptId: entry.paymentAttemptId,
              entryType: entry.entryType,
              direction: entry.direction,
              amountPaise: entry.amountPaise,
              effectiveDate: new Date(`${entry.effectiveDate}T00:00:00.000Z`),
              reference: entry.reference,
              idempotencyKey: entry.idempotencyKey,
            },
          });
        }
        await tx.paymentAttempt.update({ where: { id: row.id }, data: { status: "SUCCEEDED", debitStatus: "CONFIRMED", resolvedAt: new Date(now) } });
        await audit(tx, "PAYMENT_SUCCEEDED", row.id, detail, now);
        return { outcome: "POSTED" } as const;
      }
      case "MARK_FAILED":
        await tx.paymentAttempt.update({ where: { id: row.id }, data: { status: "FAILED", debitStatus: "NOT_DEBITED", resolvedAt: new Date(now) } });
        await audit(tx, "PAYMENT_FAILED", row.id, detail, now);
        return { outcome: "FAILED_MARKED" } as const;
      case "DUPLICATE":
        await audit(tx, "PAYMENT_DUPLICATE_EVENT", row.id, detail, now);
        return { outcome: "DUPLICATE" } as const;
      case "EXCEPTION":
        await queueException(tx, row.id, decision.reason, now);
        await audit(tx, "PAYMENT_EXCEPTION", row.id, { ...detail, reason: decision.reason }, now);
        return { outcome: "EXCEPTION", reason: decision.reason } as const;
    }
  }), { retries: TRANSACTION_RETRIES });
}
