import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { initiatePayment } from "@/server/payments/initiate";
import { applyGatewayEvent } from "@/server/payments/webhook";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/** D104: the gateway side takes the per-bill lock, so it waits for a bank posting that holds it and then sees that posting. */
let fx: PaymentsFixture;
let other: Client;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  other = new Client({ connectionString: fx.scratchUrl });
  await other.connect();
}, 120_000);
afterAll(async () => {
  await other?.end();
  await fx?.close();
}, 60_000);

const pending = <T>(promise: Promise<T>, ms: number): Promise<"PENDING" | T> => Promise.race([promise, new Promise<"PENDING">((resolve) => setTimeout(() => resolve("PENDING"), ms))]);

describe("D104 a gateway success waits for the bill's lock", () => {
  it("does not finish while another transaction holds the lock of the same bill, and finishes when it is released", async () => {
    const resident = await fx.makeResident();
    const started = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW });
    if (started.status !== "CREATED") throw new Error(started.status);
    await other.query("BEGIN");
    await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [resident.billId]);
    const event = { eventId: "evt-lock-1", type: "payment.succeeded" as const, reference: `MOCK-${started.attemptId}`, amountPaise: 646_800n };
    const applying = applyGatewayEvent(fx.app, event, DEMO_NOW);
    expect(await pending(applying, 600)).toBe("PENDING");
    expect(await fx.owner.ledgerEntry.count({ where: { paymentAttemptId: started.attemptId } })).toBe(0);
    await other.query("COMMIT");
    expect(await applying).toEqual({ outcome: "POSTED" });
  });

  it("a gateway success for ANOTHER bill is not held up by that lock", async () => {
    const held = await fx.makeResident();
    const free = await fx.makeResident();
    const started = await initiatePayment({ db: fx.app, user: free.user, expectedAmountPaise: 646_800n, now: DEMO_NOW });
    if (started.status !== "CREATED") throw new Error(started.status);
    await other.query("BEGIN");
    await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [held.billId]);
    try {
      const result = await pending(applyGatewayEvent(fx.app, { eventId: "evt-lock-2", type: "payment.succeeded", reference: `MOCK-${started.attemptId}`, amountPaise: 646_800n }, DEMO_NOW), 3000);
      expect(result).toEqual({ outcome: "POSTED" });
    } finally {
      await other.query("COMMIT");
    }
  });

  it("when a bank payment on the bill committed first, the gateway success is an exception and posts nothing", async () => {
    const resident = await fx.makeResident();
    const started = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW });
    if (started.status !== "CREATED") throw new Error(started.status);
    await other.query("BEGIN");
    await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [resident.billId]);
    await other.query(
      `INSERT INTO ledger_entries (flat_id, entry_type, direction, amount_paise, effective_date, bill_id, idempotency_key)
       VALUES ($1, 'LATE_FEE', 'CHARGE', 9800, '2026-10-27', $2, $3), ($1, 'PAYMENT', 'PAYMENT', 646800, '2026-10-27', $2, $4)`,
      [resident.flatId, resident.billId, `bank-first-fee:${started.attemptId}`, `bank-first:${started.attemptId}`],
    );
    const applying = applyGatewayEvent(fx.app, { eventId: "evt-lock-3", type: "payment.succeeded", reference: `MOCK-${started.attemptId}`, amountPaise: 646_800n }, DEMO_NOW);
    expect(await pending(applying, 400)).toBe("PENDING");
    await other.query("COMMIT");
    expect(await applying).toEqual({ outcome: "EXCEPTION", reason: "BILL_ALREADY_PAID" });
    expect(await fx.owner.ledgerEntry.count({ where: { billId: resident.billId, entryType: "PAYMENT" } })).toBe(1);
  });
});
