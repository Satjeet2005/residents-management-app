import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { initiatePayment } from "@/server/payments/initiate";
import { applyGatewayEvent } from "@/server/payments/webhook";
import { approveRequest } from "@/server/statements/approval";
import { postManualMatch } from "@/server/statements/manual";
import type { ActingUser } from "@/server/statements/manual-core";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { queuedRow, seedStaff } from "./reconciliation-helpers";

/** MP3: real concurrent transactions. The per-bill lock (D104) and the row lock make exactly ONE PAYMENT happen. */
let fx: PaymentsFixture;
let other: Client;
let priya: ActingUser;
let rahul: ActingUser;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  other = new Client({ connectionString: fx.scratchUrl });
  await other.connect();
  priya = await seedStaff(fx, "5000000001");
  rahul = await seedStaff(fx, "5000000002");
}, 120_000);
afterAll(async () => {
  await other?.end();
  await fx?.close();
}, 60_000);

const pending = <T>(promise: Promise<T>, ms: number): Promise<"PENDING" | T> => Promise.race([promise, new Promise<"PENDING">((resolve) => setTimeout(() => resolve("PENDING"), ms))]);
const REASON = "Phone call with the resident";
const manual = (user: ActingUser, row: { id: string; version: number }, flatCode: string, expectedAmountDuePaise?: bigint) =>
  postManualMatch({ db: fx.app, user, rowId: row.id, flatCode, reason: REASON, rememberPayer: false, expectedVersion: row.version, expectedAmountDuePaise, now: DEMO_NOW });
const paymentsOn = (billId: string) => fx.owner.ledgerEntry.findMany({ where: { billId, entryType: "PAYMENT" } });
const start = async (user: { id: string }, expected: bigint) => {
  const result = await initiatePayment({ db: fx.app, user, expectedAmountPaise: expected, now: DEMO_NOW });
  if (result.status !== "CREATED") throw new Error(result.status);
  return { attemptId: result.attemptId, reference: `MOCK-${result.attemptId}` };
};

describe("MP3 two staff on the same row", () => {
  it("five rounds: exactly one posts, the other is NOT_QUEUED, and the bill is paid once", async () => {
    for (let round = 0; round < 5; round++) {
      const resident = await fx.makeResident();
      const row = await queuedRow(fx, 646_800n);
      const [a, b] = await Promise.all([manual(priya, row, resident.flatCode), manual(rahul, row, resident.flatCode)]);
      const statuses = [a, b].map((r) => (r.status === "ERROR" ? r.error : r.status)).sort();
      expect(statuses, `round ${round}`).toEqual(["NOT_QUEUED", "POSTED"]);
      expect(await paymentsOn(resident.billId)).toHaveLength(1);
      expect(await fx.owner.paymentMatch.count({ where: { bankRowId: row.id } })).toBe(1);
      expect(await fx.owner.accountsQueueItem.count({ where: { bankRowId: row.id, status: "RESOLVED" } })).toBe(1);
    }
  });

  it("two rows for the same bill at once: the second finds the bill already paid, so one PAYMENT", async () => {
    const resident = await fx.makeResident();
    const first = await queuedRow(fx, 646_800n);
    const second = await queuedRow(fx, 646_800n);
    const results = await Promise.all([manual(priya, first, resident.flatCode), manual(rahul, second, resident.flatCode)]);
    expect(results.filter((r) => r.status === "POSTED")).toHaveLength(1);
    expect(results.filter((r) => r.status === "ERROR" && r.error === "NO_OPEN_BILL")).toHaveLength(1);
    expect(await paymentsOn(resident.billId)).toHaveLength(1);
  });
});

describe("MP3 a manual posting and a gateway success for one bill", () => {
  it("the manual post waits for the bill's lock and then sees the other payment: NO_OPEN_BILL, nothing posted by the bank", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 646_800n);
    await other.query("BEGIN");
    await other.query("SELECT pg_advisory_xact_lock(hashtext($1))", [resident.billId]);
    await other.query(
      `INSERT INTO ledger_entries (flat_id, entry_type, direction, amount_paise, effective_date, bill_id, idempotency_key)
       VALUES ($1, 'LATE_FEE', 'CHARGE', 9800, '2026-10-27', $2, $3), ($1, 'PAYMENT', 'PAYMENT', 646800, '2026-10-27', $2, $4)`,
      [resident.flatId, resident.billId, `mp3-fee:${row.id}`, `mp3-pay:${row.id}`],
    );
    const posting = manual(priya, row, resident.flatCode);
    expect(await pending(posting, 600)).toBe("PENDING");
    await other.query("COMMIT");
    expect(await posting).toEqual({ status: "ERROR", error: "NO_OPEN_BILL" });
    expect(await paymentsOn(resident.billId)).toHaveLength(1);
    expect(await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: "QUEUED", version: 1 });
  });

  it("a gateway success that races a manual post: exactly ONE PAYMENT, the loser is an exception or a refusal (6 rounds)", async () => {
    for (let round = 0; round < 6; round++) {
      const resident = await fx.makeResident();
      const row = await queuedRow(fx, 646_800n);
      const attempt = await start(resident.user, 646_800n);
      const [bank, gateway] = await Promise.all([
        manual(priya, row, resident.flatCode),
        applyGatewayEvent(fx.app, { eventId: `mp3-${round}-${attempt.attemptId}`, type: "payment.succeeded", reference: attempt.reference, amountPaise: 646_800n }, DEMO_NOW),
      ]);
      const payments = await paymentsOn(resident.billId);
      expect(payments, `round ${round}`).toHaveLength(1);
      if (bank.status === "POSTED") expect(gateway.outcome).toBe("EXCEPTION");
      else {
        expect(bank).toEqual({ status: "ERROR", error: "NO_OPEN_BILL" });
        expect(gateway.outcome).toBe("POSTED");
      }
      expect(await fx.owner.ledgerEntry.count({ where: { billId: resident.billId, entryType: "LATE_FEE" } })).toBe(1);
    }
  });

  it("an approval that races a gateway success: one PAYMENT; an approval that loses is STATE_CHANGED and the row returns to QUEUED", async () => {
    for (let round = 0; round < 4; round++) {
      const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
      const row = await queuedRow(fx, 2_600_000n);
      const asked = await manual(priya, row, resident.flatCode);
      expect(asked.status).toBe("AWAITING_APPROVAL");
      const attempt = await start(resident.user, 3_000_000n);
      const [approval, gateway] = await Promise.all([
        approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW }),
        applyGatewayEvent(fx.app, { eventId: `mp3b-${round}-${attempt.attemptId}`, type: "payment.succeeded", reference: attempt.reference, amountPaise: 3_000_000n }, DEMO_NOW),
      ]);
      const payments = await paymentsOn(resident.billId);
      expect(payments, `round ${round}`).toHaveLength(1);
      const state = await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } });
      if (approval.status === "APPROVED") {
        expect(payments[0].amountPaise).toBe(2_600_000n);
        expect(gateway.outcome).toBe("EXCEPTION");
        expect(state.state).toBe("MANUALLY_MATCHED");
      } else {
        expect(approval).toEqual({ status: "ERROR", error: "STATE_CHANGED" });
        expect(payments[0].amountPaise).toBe(3_000_000n);
        expect(gateway.outcome).toBe("POSTED");
        expect(state.state).toBe("QUEUED");
      }
    }
  });

  it("two approvers at once: one approves, the other is NOT_AWAITING_APPROVAL, one PAYMENT", async () => {
    const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
    const row = await queuedRow(fx, 2_600_000n);
    await manual(priya, row, resident.flatCode);
    const third = { ...rahul };
    const results = await Promise.all([approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW }), approveRequest({ db: fx.app, user: third, rowId: row.id, now: DEMO_NOW })]);
    expect(results.map((r) => (r.status === "ERROR" ? r.error : r.status)).sort()).toEqual(["APPROVED", "NOT_AWAITING_APPROVAL"]);
    expect(await paymentsOn(resident.billId)).toHaveLength(1);
  });
});
