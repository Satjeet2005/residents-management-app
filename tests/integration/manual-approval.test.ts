import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { approveRequest, ignoreRow, rejectRequest } from "@/server/statements/approval";
import { type MatchResult, postManualMatch } from "@/server/statements/manual";
import type { ActingUser } from "@/server/statements/manual-core";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { queuedRow, seedStaff } from "./reconciliation-helpers";

/** MP2: the second-approver flow, all through the APP role. Priya may match; Rahul may match and approve; a third user may only match. */
let fx: PaymentsFixture;
let priya: ActingUser;
let rahul: ActingUser;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  priya = await seedStaff(fx, "5000000001");
  rahul = await seedStaff(fx, "5000000002");
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const BIG = 2_600_000n;
const bigFlat = () => fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
const request = async (flatCode: string, user: ActingUser = priya, extra: { vpa?: string } = {}) => {
  const row = await queuedRow(fx, BIG, extra);
  const result: MatchResult = await postManualMatch({ db: fx.app, user, rowId: row.id, flatCode, reason: "Large transfer, owner confirmed", rememberPayer: extra.vpa !== undefined, expectedVersion: row.version, now: DEMO_NOW });
  expect(result.status).toBe("AWAITING_APPROVAL");
  return row;
};
const decisions = async (rowId: string) => (await fx.owner.paymentMatch.findMany({ where: { bankRowId: rowId }, orderBy: [{ decidedAt: "asc" }, { id: "asc" }] })).map((d) => d.decision);
const rowOf = (rowId: string) => fx.owner.bankRow.findUniqueOrThrow({ where: { id: rowId } });
const queueOf = (rowId: string) => fx.owner.accountsQueueItem.findFirstOrThrow({ where: { bankRowId: rowId } });

describe("MP2 approving a match", () => {
  it("a second person approves: the entries are posted, an APPROVED decision names requester and approver, the queue item is RESOLVED, the payer is remembered", async () => {
    const resident = await bigFlat();
    const vpa = `big.${Date.now().toString(36)}@oksbi`;
    const row = await request(resident.flatCode, priya, { vpa });
    const result = await approveRequest({ db: fx.app, user: rahul, rowId: row.id, note: "Seen on the statement", now: DEMO_NOW });
    expect(result).toMatchObject({ status: "APPROVED", action: "MATCH", flatCode: resident.flatCode, payerNotice: "ADDED", remaining: { kind: "PRINCIPAL_OPEN" } });
    expect(await rowOf(row.id)).toMatchObject({ state: "MANUALLY_MATCHED", flatId: resident.flatId, version: 3 });
    const payment = await fx.owner.ledgerEntry.findFirstOrThrow({ where: { flatId: resident.flatId, entryType: "PAYMENT" } });
    expect(payment).toMatchObject({ amountPaise: BIG, bankRowId: row.id, createdById: rahul.id, idempotencyKey: `manual:${row.id}:PAYMENT` });
    expect(payment.reference).toMatch(/^bank:upi:/);
    expect(await decisions(row.id)).toEqual(["REQUEST_APPROVAL", "APPROVED"]);
    const approved = await fx.owner.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id, decision: "APPROVED" } });
    expect(approved).toMatchObject({ decidedById: priya.id, approverId: rahul.id, flatId: resident.flatId, reason: "Seen on the statement" });
    expect(await queueOf(row.id)).toMatchObject({ status: "RESOLVED", resolvedById: rahul.id, note: "Seen on the statement" });
    expect(await fx.owner.knownPayer.count({ where: { flatId: resident.flatId, identifierValue: vpa, addedById: rahul.id } })).toBe(1);
    expect(await fx.owner.auditLog.count({ where: { action: "MATCH_APPROVED", entityId: row.id } })).toBe(1);
  });

  it("the person who asked cannot approve: SELF_APPROVAL from the service, before any database constraint, and nothing changes", async () => {
    const resident = await bigFlat();
    const row = await request(resident.flatCode, rahul);
    const before = await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } });
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "SELF_APPROVAL" });
    expect(await rowOf(row.id)).toMatchObject({ state: "AWAITING_APPROVAL", version: 2 });
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } })).toBe(before);
    expect(await decisions(row.id)).toEqual(["REQUEST_APPROVAL"]);
    expect(await queueOf(row.id)).toMatchObject({ status: "OPEN" });
  });

  it("the database itself refuses an approver who is the decider (J5), whatever the service does", async () => {
    const resident = await bigFlat();
    const row = await request(resident.flatCode, priya);
    await expect(fx.owner.paymentMatch.create({ data: { bankRowId: row.id, decision: "APPROVED", decidedById: priya.id, approverId: priya.id, reason: "same person" } })).rejects.toThrow(/payment_matches_approver_differs/);
  });

  it("a user with only payments:match cannot approve or reject: FORBIDDEN, nothing changes", async () => {
    const resident = await bigFlat();
    const row = await request(resident.flatCode, rahul);
    expect(await approveRequest({ db: fx.app, user: priya, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await rejectRequest({ db: fx.app, user: priya, rowId: row.id, reason: "Not allowed to", now: DEMO_NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await rowOf(row.id)).toMatchObject({ state: "AWAITING_APPROVAL" });
  });

  it("a row that is not awaiting approval, an unknown row and a short note are refused", async () => {
    const queued = await queuedRow(fx, 100_000n);
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: queued.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "NOT_AWAITING_APPROVAL" });
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: "00000000-0000-4000-8000-000000000000", now: DEMO_NOW })).toEqual({ status: "ERROR", error: "NOT_FOUND" });
    const resident = await bigFlat();
    const row = await request(resident.flatCode, priya);
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: row.id, note: "ok", now: DEMO_NOW })).toEqual({ status: "ERROR", error: "REASON_REQUIRED" });
  });

  it("a payment committed after the request: the approval posts nothing, the row returns to QUEUED with a REJECTED decision, STATE_CHANGED", async () => {
    const resident = await bigFlat();
    const row = await request(resident.flatCode, priya);
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 100_000n, effectiveDate: new Date("2026-10-20T00:00:00Z"), idempotencyKey: `mp2-change:${resident.billId}` } });
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "STATE_CHANGED" });
    expect(await rowOf(row.id)).toMatchObject({ state: "QUEUED", ledgerEntryId: null, version: 3 });
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId, entryType: "PAYMENT", bankRowId: { not: null } } })).toBe(0);
    expect(await decisions(row.id)).toEqual(["REQUEST_APPROVAL", "REJECTED"]);
    const rejected = await fx.owner.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id, decision: "REJECTED" } });
    expect(rejected.reason).toMatch(/State changed/);
    expect(await queueOf(row.id)).toMatchObject({ status: "OPEN" });
  });

  it("a rejection returns the row to QUEUED with a REJECTED decision and the reason, and the queue item stays OPEN; it can be requested again", async () => {
    const resident = await bigFlat();
    const row = await request(resident.flatCode, priya);
    expect(await rejectRequest({ db: fx.app, user: rahul, rowId: row.id, reason: "Wrong flat, check the cheque", now: DEMO_NOW })).toEqual({ status: "REJECTED" });
    expect(await rowOf(row.id)).toMatchObject({ state: "QUEUED", version: 3 });
    const rejected = await fx.owner.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id, decision: "REJECTED" } });
    expect(rejected).toMatchObject({ decidedById: rahul.id, approverId: null, reason: "Wrong flat, check the cheque" });
    expect(await queueOf(row.id)).toMatchObject({ status: "OPEN", resolvedAt: null });
    expect(await rejectRequest({ db: fx.app, user: rahul, rowId: row.id, reason: "Wrong flat, check the cheque", now: DEMO_NOW })).toEqual({ status: "ERROR", error: "NOT_AWAITING_APPROVAL" });
    expect(await rejectRequest({ db: fx.app, user: rahul, rowId: row.id, reason: "no", now: DEMO_NOW })).toEqual({ status: "ERROR", error: "REASON_REQUIRED" });
    const again = await postManualMatch({ db: fx.app, user: priya, rowId: row.id, flatCode: resident.flatCode, reason: "Owner confirmed by phone", rememberPayer: false, expectedVersion: 3, now: DEMO_NOW });
    expect(again.status).toBe("AWAITING_APPROVAL");
  });
});

describe("MP2 ignoring a row", () => {
  it("below the threshold: IGNORED at once with an IGNORE decision, the reason, and the queue item RESOLVED", async () => {
    const row = await queuedRow(fx, 1_500_000n);
    expect(await ignoreRow({ db: fx.app, user: priya, rowId: row.id, reason: "Hall rent, not maintenance", expectedVersion: 1, now: DEMO_NOW })).toEqual({ status: "IGNORED" });
    expect(await rowOf(row.id)).toMatchObject({ state: "IGNORED", flatId: null, ledgerEntryId: null, version: 2 });
    expect(await fx.owner.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id } })).toMatchObject({ decision: "IGNORE", decidedById: priya.id, reason: "Hall rent, not maintenance" });
    expect(await queueOf(row.id)).toMatchObject({ status: "RESOLVED", resolvedById: priya.id, note: "Hall rent, not maintenance" });
    expect(await fx.owner.auditLog.count({ where: { action: "ROW_IGNORED", entityId: row.id } })).toBe(1);
  });

  it("at or above the threshold: AWAITING_APPROVAL with {action: IGNORE}, the queue item stays OPEN; a second person approves it and it becomes IGNORED", async () => {
    const row = await queuedRow(fx, BIG);
    expect(await ignoreRow({ db: fx.app, user: priya, rowId: row.id, reason: "Deposit refund from a vendor", expectedVersion: 1, now: DEMO_NOW })).toEqual({ status: "AWAITING_APPROVAL", thresholdPaise: "2500000" });
    expect(await rowOf(row.id)).toMatchObject({ state: "AWAITING_APPROVAL" });
    expect((await fx.owner.paymentMatch.findFirstOrThrow({ where: { bankRowId: row.id } })).reasons).toEqual({ action: "IGNORE" });
    expect(await queueOf(row.id)).toMatchObject({ status: "OPEN" });
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "APPROVED", action: "IGNORE" });
    expect(await rowOf(row.id)).toMatchObject({ state: "IGNORED", version: 3 });
    expect(await decisions(row.id)).toEqual(["REQUEST_APPROVAL", "APPROVED"]);
    expect(await queueOf(row.id)).toMatchObject({ status: "RESOLVED", resolvedById: rahul.id });
    expect(await fx.owner.ledgerEntry.count({ where: { bankRowId: row.id } })).toBe(0);
  });

  it("an ignore above the threshold cannot be approved by the person who asked, and can be rejected", async () => {
    const row = await queuedRow(fx, BIG);
    await ignoreRow({ db: fx.app, user: rahul, rowId: row.id, reason: "Deposit refund from a vendor", expectedVersion: 1, now: DEMO_NOW });
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "SELF_APPROVAL" });
    expect(await rejectRequest({ db: fx.app, user: rahul, rowId: row.id, reason: "I changed my mind", now: DEMO_NOW })).toEqual({ status: "REJECTED" });
    expect(await rowOf(row.id)).toMatchObject({ state: "QUEUED" });
  });

  it("a reason is required, a wrong version is STALE, a row already decided is NOT_QUEUED, a user without payments:match is FORBIDDEN", async () => {
    const row = await queuedRow(fx, 50_000n);
    expect(await ignoreRow({ db: fx.app, user: priya, rowId: row.id, reason: "", expectedVersion: 1, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "REASON_REQUIRED" });
    expect(await ignoreRow({ db: fx.app, user: priya, rowId: row.id, reason: "Not maintenance", expectedVersion: 4, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "STALE" });
    expect(await ignoreRow({ db: fx.app, user: { ...priya, permissions: ["payments:approve"] }, rowId: row.id, reason: "Not maintenance", expectedVersion: 1, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect((await ignoreRow({ db: fx.app, user: priya, rowId: row.id, reason: "Not maintenance", expectedVersion: 1, now: DEMO_NOW })).status).toBe("IGNORED");
    expect(await ignoreRow({ db: fx.app, user: priya, rowId: row.id, reason: "Not maintenance", expectedVersion: 2, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "NOT_QUEUED" });
  });
});
