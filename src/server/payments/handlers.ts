import { z } from "zod";
import type { GuardContext } from "@/server/auth/guard";
import { businessNow } from "@/server/clock";
import { type PaymentGateway, paymentProviderConfigured } from "./gateway";
import { initiatePayment } from "./initiate";

/** A body of this size is already far more than `{ "expectedAmountPaise": "646800" }`. */
const MAX_BODY_CHARS = 1024;

/** Money crosses the wire as a decimal string (JSON has no bigint). At most 15 digits, no sign, no fraction. */
export const initiateBody = z.object({ expectedAmountPaise: z.string().regex(/^[0-9]{1,15}$/) });

const json = (status: number, body: unknown): Response => Response.json(body, { status });

/**
 * POST /api/payments (the route wraps this in withPermission("RESIDENT")). Answers
 * - 200 `{ attemptId, checkoutPath, amountPaise }` for a new or an existing attempt,
 * - 409 `{ error: "AMOUNT_CHANGED", amountPaise }` when the amount the person saw is not today's amount,
 * - 409 `{ error: "NO_DUES" }` when nothing is open,
 * - 400 `{ error: "INVALID_REQUEST" }` for a bad body,
 * - 503 `{ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }` when DEMO_MODE is not exactly "true" (only the mock exists).
 * `now` is the business clock (D97); tests pass their own.
 */
export async function handleInitiate(
  context: Pick<GuardContext, "user" | "deps" | "request">,
  options: { env?: Readonly<Record<string, string | undefined>>; now?: number; gateway?: PaymentGateway } = {},
): Promise<Response> {
  if (!paymentProviderConfigured(options.env ?? process.env)) return json(503, { error: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
  const text = await context.request.text();
  let value: unknown = null;
  try {
    value = text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
  } catch {
    value = null;
  }
  const body = initiateBody.safeParse(value);
  if (!body.success) return json(400, { error: "INVALID_REQUEST" });

  const result = await initiatePayment({
    db: context.deps.db,
    user: context.user,
    expectedAmountPaise: BigInt(body.data.expectedAmountPaise),
    now: options.now ?? businessNow(options.env ?? process.env),
    gateway: options.gateway,
  });
  switch (result.status) {
    case "CREATED":
    case "EXISTING":
      return json(200, { attemptId: result.attemptId, checkoutPath: result.checkoutPath, amountPaise: result.amountPaise.toString() });
    case "AMOUNT_CHANGED":
      return json(409, { error: "AMOUNT_CHANGED", amountPaise: result.amountPaise.toString() });
    case "NO_DUES":
      return json(409, { error: "NO_DUES" });
  }
}
