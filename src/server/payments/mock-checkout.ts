import { randomUUID } from "node:crypto";
import { z } from "zod";
import { istDateOf } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import type { SessionUser } from "@/server/auth/session-service";
import { findCurrentMemberships } from "@/server/home/queries";
import { type Env, type ApplyOutcome, applyGatewayEvent, signWebhook, verifyWebhook } from "./webhook";
import { paymentProviderConfigured } from "./gateway";

export type MockOutcome = "SUCCESS" | "FAILURE";

export type MockCheckout = { attemptId: string; flatCode: string; amountPaise: bigint; status: "INITIATED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "RELEASED" };

const attemptIdSchema = z.uuid();

/**
 * The attempt behind the demo payment page, or null: the page is a 404 when the mock gateway is not allowed (DEMO_MODE is
 * not exactly "true"), when the id is not a UUID, and when the attempt is not in the signed-in person's own current flat
 * (so another flat's checkout cannot be opened or even told apart from one that does not exist).
 */
export async function loadMockCheckout(input: { db: Db; user: Pick<SessionUser, "id">; attemptId: string; now: number; env?: Env }): Promise<MockCheckout | null> {
  if (!paymentProviderConfigured(input.env ?? process.env)) return null;
  const id = attemptIdSchema.safeParse(input.attemptId);
  if (!id.success) return null;
  const flats = (await findCurrentMemberships(input.db, input.user.id, istDateOf(input.now))).map((m) => m.flatId);
  if (flats.length === 0) return null;
  const attempt = await input.db.paymentAttempt.findFirst({ where: { id: id.data, flatId: { in: flats } }, select: { id: true, amountPaise: true, status: true, flat: { select: { code: true } } } });
  return attempt === null ? null : { attemptId: attempt.id, flatCode: attempt.flat.code, amountPaise: attempt.amountPaise, status: attempt.status };
}

/**
 * What a button of the demo page does: build the event a real gateway would send, sign it with PAYMENT_WEBHOOK_SECRET, and
 * send it through the SAME `verifyWebhook` and `applyGatewayEvent` that the real route uses, so the demo cannot take a shortcut
 * the real path does not have. The secret is read here and never returned or printed. Returns the outcome, or "NOT_FOUND"
 * when the checkout is not available to this person (see loadMockCheckout). A missing secret throws (fail closed).
 */
export async function completeMockPayment(input: { db: Db; user: Pick<SessionUser, "id">; attemptId: string; outcome: MockOutcome; now: number; env?: Env }): Promise<ApplyOutcome | { outcome: "UNKNOWN_REFERENCE" } | "NOT_FOUND"> {
  const env = input.env ?? process.env;
  const checkout = await loadMockCheckout({ ...input, env });
  if (checkout === null) return "NOT_FOUND";
  const attempt = await input.db.paymentAttempt.findUniqueOrThrow({ where: { id: checkout.attemptId }, select: { gatewayReference: true, amountPaise: true } });
  const rawBody = JSON.stringify({
    eventId: `mock-${randomUUID()}`,
    type: input.outcome === "SUCCESS" ? "payment.succeeded" : "payment.failed",
    reference: attempt.gatewayReference ?? "",
    amountPaise: attempt.amountPaise.toString(),
  });
  const secret = env.PAYMENT_WEBHOOK_SECRET;
  const headers = new Headers(signWebhook(rawBody, secret ?? "", input.now, env));
  const verified = verifyWebhook(rawBody, headers, secret, input.now, env);
  if (verified.kind !== "OK") throw new Error("the demo event did not verify");
  return applyGatewayEvent(input.db, verified.event, input.now);
}
