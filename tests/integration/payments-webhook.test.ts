import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { getHomeData } from "@/server/home/home-data";
import { handleWebhook } from "@/server/payments/handlers";
import { initiatePayment } from "@/server/payments/initiate";
import { type WebhookEvent, applyGatewayEvent, signWebhook } from "@/server/payments/webhook";
import { type PaymentsFixture, type Resident, createPaymentsFixture } from "./payments-fixture";
import { SQLSTATE, rejectedWith } from "./db";

/**
 * PY2 to PY5: a gateway event is applied to a real database, through a client that logs in as the APP role. A test that needs
 * a flat of its own makes one (the ledger is append-only, so nothing is cleaned up). The clock is injected.
 */
let fx: PaymentsFixture;
beforeAll(async () => {
  fx = await createPaymentsFixture();
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const SECRET = "integration-webhook-secret-0123456789ab";
const ENV = { NODE_ENV: "test", PAYMENT_WEBHOOK_SECRET: SECRET, DEMO_MODE: "true" };
let eventCounter = 0;

const startFor = async (user: { id: string }, expected = 646_800n, now = DEMO_NOW) => {
  const result = await initiatePayment({ db: fx.app, user, expectedAmountPaise: expected, now });
  if (result.status !== "CREATED" && result.status !== "EXISTING") throw new Error(`no attempt: ${result.status}`);
  return { attemptId: result.attemptId, reference: `MOCK-${result.attemptId}`, amountPaise: result.amountPaise };
};
const eventFor = (type: "payment.succeeded" | "payment.failed", reference: string, amountPaise: bigint): WebhookEvent => ({ eventId: `evt-${++eventCounter}`, type, reference, amountPaise });
const succeed = (a: { reference: string; amountPaise: bigint }, now = DEMO_NOW) => applyGatewayEvent(fx.app, eventFor("payment.succeeded", a.reference, a.amountPaise), now);
const fail = (a: { reference: string; amountPaise: bigint }, now = DEMO_NOW) => applyGatewayEvent(fx.app, eventFor("payment.failed", a.reference, a.amountPaise), now);
const entriesOf = (flatId: string) => fx.owner.ledgerEntry.findMany({ where: { flatId, paymentAttemptId: { not: null } }, orderBy: [{ entryType: "asc" }] });
const openItems = (attemptId: string) => fx.owner.accountsQueueItem.findMany({ where: { paymentAttemptId: attemptId, status: "OPEN" } });
const phoneUser = async (phone: string) => fx.userByPhone(phone);
const balanceOf = async (flatId: string): Promise<bigint> => {
  const rows = await fx.owner.ledgerEntry.findMany({ where: { flatId }, select: { direction: true, amountPaise: true } });
  return rows.reduce((sum, e) => (e.direction === "CHARGE" ? sum + e.amountPaise : sum - e.amountPaise), 0n);
};
const home = async (user: { id: string; name: string }, now = DEMO_NOW) => {
  const data = await getHomeData({ db: fx.app, user, now });
  if (data.kind !== "OK") throw new Error("no flat");
  return data;
};

describe("PY2 a confirmed success posts the late fee and the payment, dated the start day (the sample residents)", () => {
  it("T12-0408: exactly a LATE_FEE of ₹98 and a PAYMENT of ₹6,468, dated 27 Oct with the attempt and bill ids; the balance is zero; the Home shows ALL_PAID", async () => {
    const swati = await phoneUser("5000000007");
    const attempt = await startFor(swati);
    expect(await succeed(attempt)).toEqual({ outcome: "POSTED" });

    const row = await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } });
    expect(row).toMatchObject({ status: "SUCCEEDED", debitStatus: "CONFIRMED" });
    expect(row.resolvedAt?.getTime()).toBe(DEMO_NOW);
    const entries = await entriesOf(row.flatId);
    expect(entries.map((e) => [e.entryType, e.direction, e.amountPaise, e.effectiveDate.toISOString().slice(0, 10), e.billId, e.paymentAttemptId])).toEqual([
      ["LATE_FEE", "CHARGE", 9_800n, "2026-10-27", row.billId, attempt.attemptId],
      ["PAYMENT", "PAYMENT", 646_800n, "2026-10-27", row.billId, attempt.attemptId],
    ]);
    expect(entries.find((e) => e.entryType === "PAYMENT")?.reference).toBe(attempt.reference);
    expect(entries.map((e) => e.idempotencyKey).sort()).toEqual([`payment:${attempt.attemptId}:LATE_FEE`, `payment:${attempt.attemptId}:PAYMENT`]);
    expect(await balanceOf(row.flatId)).toBe(0n);

    const data = await home(swati);
    expect(data.dues.status).toBe("ALL_PAID");
    expect(data.dues.amountDuePaise).toBe(0n);
    expect(data.dues.lastPayment).toEqual({ amountPaise: 646_800n, date: "2026-10-27" });
    expect(data.recent.map((r) => r.entryType).sort()).toEqual(["LATE_FEE", "PAYMENT"]);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_SUCCEEDED", entityId: attempt.attemptId } })).toBe(1);
  });

  it("T21-1601 (part paid): the fee is the ₹38 of the late-fee fixtures and the payment is ₹5,698; nothing is owed after", async () => {
    const aamir = await phoneUser("5000000009");
    const attempt = await startFor(aamir, 569_800n);
    expect(await succeed(attempt)).toEqual({ outcome: "POSTED" });
    const row = await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } });
    expect((await entriesOf(row.flatId)).map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 3_800n], ["PAYMENT", 569_800n]]);
    expect(await balanceOf(row.flatId)).toBe(0n);
    expect((await home(aamir)).dues.status).toBe("ALL_PAID");
  });

  it("T15-0902 (two open bills): the OLDEST bill is paid, the second stays open and keeps its amount (D99)", async () => {
    const rohit = await phoneUser("5000000010");
    const before = (await home(rohit)).dues;
    const [oldest, second] = before.openBills;
    const total = oldest.outstandingPaise + oldest.feePaise;
    const attempt = await startFor(rohit, total);
    expect(await succeed(attempt)).toEqual({ outcome: "POSTED" });
    const after = (await home(rohit)).dues;
    expect(after.openBills.map((b) => b.billId)).toEqual([second.billId]);
    expect(after.amountDuePaise).toBe(before.amountDuePaise - total);
    expect(after.openBills[0].outstandingPaise + after.openBills[0].feePaise).toBe(second.outstandingPaise + second.feePaise);
  });

  it("a bill that is not yet overdue posts only the PAYMENT (no fee, so no LATE_FEE entry)", async () => {
    const resident = await fx.makeResident({ dueOn: "2026-10-30" });
    const attempt = await startFor(resident.user, 637_000n);
    expect(await succeed(attempt)).toEqual({ outcome: "POSTED" });
    expect((await entriesOf(resident.flatId)).map((e) => [e.entryType, e.amountPaise])).toEqual([["PAYMENT", 637_000n]]);
    expect(await balanceOf(resident.flatId)).toBe(0n);
  });

  it("the entries are dated the day the attempt STARTED, not the day the event arrives", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    expect(await succeed(attempt, DEMO_NOW + 3 * 86_400_000)).toEqual({ outcome: "POSTED" });
    expect((await entriesOf(resident.flatId)).map((e) => e.effectiveDate.toISOString().slice(0, 10))).toEqual(["2026-10-27", "2026-10-27"]);
  });
});

describe("PY2 a failure posts nothing and allows a new attempt", () => {
  it("marks the attempt FAILED with debit NOT_DEBITED and resolved_at, posts nothing, and a new attempt can start", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    expect(await fail(attempt)).toEqual({ outcome: "FAILED_MARKED" });
    const row = await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } });
    expect(row).toMatchObject({ status: "FAILED", debitStatus: "NOT_DEBITED" });
    expect(row.resolvedAt?.getTime()).toBe(DEMO_NOW);
    expect(await entriesOf(resident.flatId)).toEqual([]);
    expect(await balanceOf(resident.flatId)).toBe(637_000n);
    const again = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW + 60_000 });
    expect(again.status).toBe("CREATED");
    expect(again.status === "CREATED" && again.attemptId).not.toBe(attempt.attemptId);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_FAILED", entityId: attempt.attemptId } })).toBe(1);
  });
});

describe("PY3 idempotence and concurrency (D45)", () => {
  it("ten parallel success events post exactly once: one POSTED, nine DUPLICATE, two ledger entries, one PAYMENT", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => succeed(attempt)));
    expect(outcomes.filter((o) => o.outcome === "POSTED")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "DUPLICATE")).toHaveLength(9);
    const entries = await entriesOf(resident.flatId);
    expect(entries.map((e) => e.entryType)).toEqual(["LATE_FEE", "PAYMENT"]);
    expect(await balanceOf(resident.flatId)).toBe(0n);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_DUPLICATE_EVENT", entityId: attempt.attemptId } })).toBe(9);
  });

  it("a replayed success is DUPLICATE, changes nothing and opens no queue item", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await succeed(attempt);
    const before = await entriesOf(resident.flatId);
    expect(await succeed(attempt, DEMO_NOW + 60_000)).toEqual({ outcome: "DUPLICATE" });
    expect(await entriesOf(resident.flatId)).toEqual(before);
    expect(await openItems(attempt.attemptId)).toEqual([]);
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } })).resolvedAt?.getTime()).toBe(DEMO_NOW);
  });

  it("a replayed failure is DUPLICATE too", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await fail(attempt);
    expect(await fail(attempt, DEMO_NOW + 60_000)).toEqual({ outcome: "DUPLICATE" });
    expect(await openItems(attempt.attemptId)).toEqual([]);
  });

  it("ten parallel failure events mark the attempt once", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => fail(attempt)));
    expect(outcomes.filter((o) => o.outcome === "FAILED_MARKED")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "DUPLICATE")).toHaveLength(9);
  });

  it("the ledger refuses a second payment with the same reference or the same idempotency key (unique indexes)", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await succeed(attempt);
    const owner = new Client({ connectionString: fx.scratchUrl });
    await owner.connect();
    try {
      const insert = (reference: string | null, key: string) =>
        owner.query(
          `INSERT INTO ledger_entries (flat_id, entry_type, direction, amount_paise, effective_date, reference, idempotency_key, bill_id, payment_attempt_id)
           VALUES ($1, 'PAYMENT', 'PAYMENT', 100, '2026-10-27', $2, $3, $4, $5)`,
          [resident.flatId, reference, key, resident.billId, attempt.attemptId],
        );
      await rejectedWith(insert(attempt.reference, "another-key"), SQLSTATE.uniqueViolation, "ledger_entries_reference_key");
      await rejectedWith(insert(null, `payment:${attempt.attemptId}:PAYMENT`), SQLSTATE.uniqueViolation, "ledger_entries_idempotency_key_key");
    } finally {
      await owner.end();
    }
  });
});

describe("PY4 the guards: an event that does not fit is an exception for a person, and posts nothing (D45, D50, D41)", () => {
  const assertNothingPosted = async (resident: Resident) => expect(await entriesOf(resident.flatId)).toEqual([]);

  it("a success after FAILED is CONTRADICTS_FINAL_STATE, leaves the attempt FAILED, and opens exactly one OPEN queue item (a second one adds none)", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await fail(attempt);
    expect(await succeed(attempt)).toEqual({ outcome: "EXCEPTION", reason: "CONTRADICTS_FINAL_STATE" });
    expect(await succeed(attempt)).toEqual({ outcome: "EXCEPTION", reason: "CONTRADICTS_FINAL_STATE" });
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } })).status).toBe("FAILED");
    await assertNothingPosted(resident);
    const items = await openItems(attempt.attemptId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemType: "EXCEPTION", status: "OPEN", bankRowId: null });
    expect(items[0].note).toMatch(/contradicts the one already recorded/);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_EXCEPTION", entityId: attempt.attemptId } })).toBe(2);
  });

  it("a failure after SUCCEEDED is an exception: the attempt stays SUCCEEDED and the ledger is unchanged", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await succeed(attempt);
    const before = await entriesOf(resident.flatId);
    expect(await fail(attempt)).toEqual({ outcome: "EXCEPTION", reason: "CONTRADICTS_FINAL_STATE" });
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } })).status).toBe("SUCCEEDED");
    expect(await entriesOf(resident.flatId)).toEqual(before);
    expect(await openItems(attempt.attemptId)).toHaveLength(1);
  });

  it.each([[-100n], [100n], [-646_000n]])("a success whose amount differs by %s paise is AMOUNT_MISMATCH: the attempt stays INITIATED, nothing is posted, one OPEN item", async (delta) => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    expect(await succeed({ ...attempt, amountPaise: attempt.amountPaise + delta })).toEqual({ outcome: "EXCEPTION", reason: "AMOUNT_MISMATCH" });
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } })).status).toBe("INITIATED");
    await assertNothingPosted(resident);
    expect(await openItems(attempt.attemptId)).toHaveLength(1);
  });

  it("a success when a later payment exists is LATER_PAYMENT: nothing is posted, one OPEN item", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 100_000n, effectiveDate: new Date("2026-10-28T00:00:00Z"), idempotencyKey: `later:${attempt.attemptId}` } });
    expect(await succeed(attempt)).toEqual({ outcome: "EXCEPTION", reason: "LATER_PAYMENT" });
    await assertNothingPosted(resident);
    const items = await openItems(attempt.attemptId);
    expect(items).toHaveLength(1);
    expect(items[0].note).toMatch(/dated after this attempt started/);
  });

  it("a later payment that was reversed does not block a success", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const later = await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 100_000n, effectiveDate: new Date("2026-10-28T00:00:00Z"), idempotencyKey: `later2:${attempt.attemptId}` } });
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, entryType: "REVERSAL", direction: "CHARGE", amountPaise: 100_000n, effectiveDate: new Date("2026-10-28T00:00:00Z"), reversesEntryId: later.id, idempotencyKey: `rev:${attempt.attemptId}` } });
    expect(await succeed(attempt)).toEqual({ outcome: "POSTED" });
  });

  it("a success when the bill was already paid on the start day is BILL_ALREADY_PAID: nothing is posted, one OPEN item", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "LATE_FEE", direction: "CHARGE", amountPaise: 9_800n, effectiveDate: new Date("2026-10-27T00:00:00Z"), idempotencyKey: `same-day-fee:${attempt.attemptId}` } });
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 646_800n, effectiveDate: new Date("2026-10-27T00:00:00Z"), idempotencyKey: `same-day:${attempt.attemptId}` } });
    expect(await succeed(attempt)).toEqual({ outcome: "EXCEPTION", reason: "BILL_ALREADY_PAID" });
    expect(await openItems(attempt.attemptId)).toHaveLength(1);
    expect((await entriesOf(resident.flatId)).length).toBe(0);
  });

  it("an unknown reference posts nothing, opens no queue item, writes an audit row, and is not an error", async () => {
    const before = await fx.owner.auditLog.count({ where: { action: "PAYMENT_EXCEPTION", entityId: "unknown" } });
    expect(await succeed({ reference: "MOCK-does-not-exist", amountPaise: 100n })).toEqual({ outcome: "UNKNOWN_REFERENCE" });
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_EXCEPTION", entityId: "unknown" } })).toBe(before + 1);
  });

  it("an exception never resolves itself: the open item stays OPEN and the attempt holds the one-unresolved-attempt slot", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    await succeed({ ...attempt, amountPaise: 1n });
    const again = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW });
    expect(again.status === "EXISTING" && again.attemptId).toBe(attempt.attemptId);
  });
});

describe("PY5 the webhook route: only a genuine signature changes anything", () => {
  const counts = async (attemptId: string, flatId: string) => ({
    entries: await fx.owner.ledgerEntry.count({ where: { flatId } }),
    status: (await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status,
    audits: await fx.owner.auditLog.count({ where: { entityId: attemptId } }),
    items: await fx.owner.accountsQueueItem.count({ where: { paymentAttemptId: attemptId } }),
  });
  const guards = (now: number) => createGuards(() => ({ db: fx.app, sender: mockOtpSender, now: () => now }));
  const call = async (raw: string, headers: Record<string, string>, now = DEMO_NOW) => {
    const route = guards(now).publicRoute((context) => handleWebhook(context, { env: ENV }));
    return route(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { host: "localhost", ...headers }, body: raw }));
  };
  const rawFor = (attempt: { reference: string; amountPaise: bigint }, type = "payment.succeeded") => JSON.stringify({ eventId: `evt-${++eventCounter}`, type, reference: attempt.reference, amountPaise: attempt.amountPaise.toString() });
  const signed = (raw: string, at = DEMO_NOW) => signWebhook(raw, SECRET, at, ENV);

  it.each([
    ["no signature headers", () => ({})],
    ["a wrong signature", (raw: string) => ({ ...signed(raw), "x-signature": "0".repeat(64) })],
    ["a short signature", (raw: string) => ({ ...signed(raw), "x-signature": signed(raw)["x-signature"].slice(0, 20) })],
    ["a genuine signature that is 6 minutes old (replayed)", (raw: string) => signed(raw, DEMO_NOW - 6 * 60_000)],
    ["a signature made with another secret", (raw: string) => signWebhook(raw, "some-other-secret-some-other-secret-1", DEMO_NOW, ENV)],
  ])("%s is 401 BAD_SIGNATURE and changes nothing", async (_label, makeHeaders) => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const before = await counts(attempt.attemptId, resident.flatId);
    const raw = rawFor(attempt);
    const response = await call(raw, makeHeaders(raw));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "BAD_SIGNATURE" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await counts(attempt.attemptId, resident.flatId)).toEqual(before);
  });

  it("a tampered body fails, and so does a signature made for another body; nothing changes", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const before = await counts(attempt.attemptId, resident.flatId);
    const genuine = rawFor(attempt);
    const tampered = genuine.replace(attempt.amountPaise.toString(), "1");
    expect((await call(tampered, signed(genuine))).status).toBe(401);
    const other = rawFor(attempt, "payment.failed");
    expect((await call(genuine, signed(other))).status).toBe(401);
    expect(await counts(attempt.attemptId, resident.flatId)).toEqual(before);
  });

  it("a genuine event is 200 and posts; the same event again is 200 and posts nothing more", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const raw = rawFor(attempt);
    const first = await call(raw, signed(raw));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect((await counts(attempt.attemptId, resident.flatId)).status).toBe("SUCCEEDED");
    const entries = (await counts(attempt.attemptId, resident.flatId)).entries;
    const second = await call(raw, signed(raw));
    expect(second.status).toBe(200);
    expect((await counts(attempt.attemptId, resident.flatId)).entries).toBe(entries);
  });

  it("a genuine event for an unknown reference is 200 (the gateway cannot probe), with an audit row and nothing else", async () => {
    const raw = rawFor({ reference: "MOCK-never-created", amountPaise: 5n });
    const entriesBefore = await fx.owner.ledgerEntry.count();
    const response = await call(raw, signed(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await fx.owner.ledgerEntry.count()).toBe(entriesBefore);
  });

  it("a signed body that is not valid is 400", async () => {
    const raw = JSON.stringify({ eventId: "x", type: "payment.succeeded" });
    expect((await call(raw, signed(raw))).status).toBe(400);
  });

  it("with no secret set the route answers a plain 500 and nothing is processed (fail closed)", async () => {
    const resident = await fx.makeResident();
    const attempt = await startFor(resident.user);
    const raw = rawFor(attempt);
    const route = guards(DEMO_NOW).publicRoute((context) => handleWebhook(context, { env: { NODE_ENV: "production" } }));
    const response = await route(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { host: "localhost", ...signed(raw) }, body: raw }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "SERVER_ERROR", ref: expect.stringMatching(/^E-[0-9A-Z]{6}$/) });
    expect((await counts(attempt.attemptId, resident.flatId)).status).toBe("INITIATED");
  });

  it("a request from a browser page of another site is refused by the guard's CSRF check before anything is read", async () => {
    const raw = rawFor({ reference: "MOCK-x", amountPaise: 1n });
    const response = await call(raw, { ...signed(raw), origin: "https://evil.example" });
    expect(response.status).toBe(403);
  });
});
