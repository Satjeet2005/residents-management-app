import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { DEMO_NOW } from "@/domain/seed/types";
import { getHomeData } from "@/server/home/home-data";
import { type MatchResult, postManualMatch } from "@/server/statements/manual";
import type { ActingUser } from "@/server/statements/manual-core";
import { type PaymentsFixture, type Resident, createPaymentsFixture } from "./payments-fixture";
import { queuedRow, seedStaff } from "./reconciliation-helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/** MP1, MP4 and MP5: a manual match through the posting plans, as the APP role, on a database seeded with the demo data. */
let fx: PaymentsFixture;
let priya: ActingUser;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  priya = await seedStaff(fx, "5000000001");
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const REASON = "Phone call with the resident";
const match = (row: { id: string; version: number }, flatCode: string, over: Partial<Parameters<typeof postManualMatch>[0]> = {}): Promise<MatchResult> =>
  postManualMatch({ db: fx.app, user: priya, rowId: row.id, flatCode, reason: REASON, rememberPayer: false, expectedVersion: row.version, now: DEMO_NOW, ...over });
const t21 = (): Promise<Resident> => fx.makeResident({ billAmountPaise: 1_066_000n, dueOn: "2026-10-09", payments: [{ date: "2026-10-12", amountPaise: 500_000n }] });
const ledgerOf = (flatId: string) => fx.owner.ledgerEntry.findMany({ where: { flatId, entryType: { in: ["LATE_FEE", "PAYMENT"] } }, orderBy: [{ createdAt: "asc" }] });
const shape = (entries: { entryType: string; amountPaise: bigint }[]) => entries.map((e) => `${e.entryType} ${e.amountPaise}`);
const nothingChanged = async (rowId: string, flatId: string, ledgerCount: number) => {
  const row = await fx.owner.bankRow.findUniqueOrThrow({ where: { id: rowId } });
  expect(row).toMatchObject({ state: "QUEUED", flatId: null, ledgerEntryId: null, version: 1 });
  expect(await fx.owner.ledgerEntry.count({ where: { flatId } })).toBe(ledgerCount);
  expect(await fx.owner.paymentMatch.count({ where: { bankRowId: rowId } })).toBe(0);
  expect(await fx.owner.accountsQueueItem.count({ where: { bankRowId: rowId, status: "OPEN" } })).toBe(1);
};

describe("MP1 a manual match posts exactly what planPosting plans", () => {
  it("equals-due: LATE_FEE ₹98 and ONE PAYMENT ₹6,468 dated the row's date, the row MANUALLY_MATCHED, a MANUAL decision, the queue item RESOLVED with the reason", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 646_800n);
    const result = await match(row, resident.flatCode);
    expect(result).toMatchObject({ status: "POSTED", flatCode: resident.flatCode, remaining: { kind: "SETTLED", duePaise: "0" } });

    const entries = await fx.owner.ledgerEntry.findMany({ where: { flatId: resident.flatId, entryType: { in: ["LATE_FEE", "PAYMENT"] } }, orderBy: { entryType: "asc" } });
    expect(entries.map((e) => [e.entryType, e.direction, e.amountPaise, e.effectiveDate.toISOString().slice(0, 10), e.billId, e.bankRowId, e.createdById, e.idempotencyKey])).toEqual([
      ["LATE_FEE", "CHARGE", 9_800n, "2026-10-27", resident.billId, null, priya.id, `manual:${row.id}:LATE_FEE`],
      ["PAYMENT", "PAYMENT", 646_800n, "2026-10-27", resident.billId, row.id, priya.id, `manual:${row.id}:PAYMENT`],
    ]);
    expect(entries[1].reference).toMatch(/^bank:upi:[0-9]{12}$/);
    expect(entries[0].reference).toBeNull();

    const after = await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ state: "MANUALLY_MATCHED", flatId: resident.flatId, ledgerEntryId: entries[1].id, version: 2 });
    const [decision] = await fx.owner.paymentMatch.findMany({ where: { bankRowId: row.id } });
    expect(decision).toMatchObject({ decision: "MANUAL", flatId: resident.flatId, decidedById: priya.id, approverId: null, reason: REASON });
    const item = await fx.owner.accountsQueueItem.findFirstOrThrow({ where: { bankRowId: row.id } });
    expect(item).toMatchObject({ status: "RESOLVED", resolvedById: priya.id, note: REASON });
    expect(item.resolvedAt).not.toBeNull();
    const audit = await fx.owner.auditLog.findFirstOrThrow({ where: { action: "MANUAL_MATCH_POSTED", entityId: row.id } });
    expect(JSON.stringify(audit.detail)).toContain(entries[1].id);
    expect(JSON.stringify(audit.detail)).not.toMatch(/PAYMENT FOR FLAT|maint/i);
  });

  it("principal only (T21-1601): PAYMENT ₹5,660 and LATE_FEE ₹38, the response states the fee still owing, and the Home shows Late fee due ₹38", async () => {
    const resident = await t21();
    const row = await queuedRow(fx, 566_000n);
    const result = await match(row, resident.flatCode);
    expect(result).toMatchObject({ status: "POSTED", remaining: { kind: "FEE_ONLY", duePaise: "3800", feeOwedPaise: "3800" } });
    expect(shape(await ledgerOf(resident.flatId))).toEqual(["PAYMENT 500000", "LATE_FEE 3800", "PAYMENT 566000"]);
    const user = await fx.owner.user.findFirstOrThrow({ where: { name: resident.name }, select: { id: true, name: true } });
    const home = await getHomeData({ db: fx.app, user, now: DEMO_NOW });
    if (home.kind !== "OK") throw new Error("no flat");
    expect(home.dues).toMatchObject({ status: "LATE_FEE_DUE", amountDuePaise: 3_800n });
    const words = renderToStaticMarkup(h(HomeView, { data: home })).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(words).toContain("Late fee due");
    expect(words).toContain("₹38");
  });

  it("partial (below the principal): a PAYMENT alone, no LATE_FEE, the fee keeps accruing", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 100_000n);
    const result = await match(row, resident.flatCode);
    expect(result).toMatchObject({ status: "POSTED", remaining: { kind: "PRINCIPAL_OPEN", duePaise: "546800", feeOwedPaise: null } });
    expect(shape(await ledgerOf(resident.flatId))).toEqual(["PAYMENT 100000"]);
  });

  it("a payment to an existing FEE_ONLY position: a PAYMENT alone, never a second LATE_FEE, then the bill is settled", async () => {
    const resident = await fx.makeResident({ payments: [{ date: "2026-10-27", amountPaise: 637_000n }], lateFees: [{ date: "2026-10-27", amountPaise: 9_800n }] });
    const row = await queuedRow(fx, 9_800n);
    expect(await match(row, resident.flatCode)).toMatchObject({ status: "POSTED", remaining: { kind: "SETTLED" } });
    expect(shape(await ledgerOf(resident.flatId))).toEqual(["PAYMENT 637000", "LATE_FEE 9800", "PAYMENT 9800"]);
  });

  it("an over-payment is refused NEEDS_ADVANCE_HANDLING and nothing changes", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 700_000n);
    const before = await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } });
    expect(await match(row, resident.flatCode)).toEqual({ status: "ERROR", error: "NEEDS_ADVANCE_HANDLING" });
    await nothingChanged(row.id, resident.flatId, before);
  });

  it("a flat with no open bill is refused NO_OPEN_BILL and nothing changes", async () => {
    const resident = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 639_100n }], lateFees: [{ date: "2026-09-20", amountPaise: 2_100n }] });
    const row = await queuedRow(fx, 5_000n);
    const before = await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } });
    expect(await match(row, resident.flatCode)).toEqual({ status: "ERROR", error: "NO_OPEN_BILL" });
    await nothingChanged(row.id, resident.flatId, before);
  });

  it("the oldest open position is paid, not the newest: two open bills, the older one gets the payment", async () => {
    const resident = await fx.makeResident({ secondBill: { amountPaise: 700_000n, dueOn: "2026-10-10" } });
    const row = await queuedRow(fx, 646_800n);
    await match(row, resident.flatCode);
    const payment = await fx.owner.ledgerEntry.findFirstOrThrow({ where: { flatId: resident.flatId, entryType: "PAYMENT" } });
    expect(payment.billId).toBe(resident.billId);
  });

  it("an unknown flat, a short reason, a wrong version and a row that is not QUEUED are refused with their own codes", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 100_000n);
    expect(await match(row, "T99-9999")).toEqual({ status: "ERROR", error: "FLAT_NOT_FOUND" });
    expect(await match(row, resident.flatCode, { reason: "ok" })).toEqual({ status: "ERROR", error: "REASON_REQUIRED" });
    expect(await match(row, resident.flatCode, { reason: "     " })).toEqual({ status: "ERROR", error: "REASON_REQUIRED" });
    expect(await match(row, resident.flatCode, { reason: "x".repeat(501) })).toEqual({ status: "ERROR", error: "REASON_REQUIRED" });
    expect(await match(row, resident.flatCode, { expectedVersion: 7 })).toEqual({ status: "ERROR", error: "STALE" });
    expect(await match({ id: "00000000-0000-4000-8000-000000000000", version: 1 }, resident.flatCode)).toEqual({ status: "ERROR", error: "NOT_FOUND" });
    expect((await match(row, resident.flatCode)).status).toBe("POSTED");
    expect(await match(row, resident.flatCode, { expectedVersion: 2 })).toEqual({ status: "ERROR", error: "NOT_QUEUED" });
  });

  it("a credit at or above the threshold is not posted: AWAITING_APPROVAL, a REQUEST_APPROVAL decision, the queue item stays OPEN", async () => {
    const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
    const row = await queuedRow(fx, 1_000_000n);
    const result = await match(row, resident.flatCode, { rememberPayer: true });
    expect(result).toEqual({ status: "AWAITING_APPROVAL", thresholdPaise: "1000000" });
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId, entryType: "PAYMENT" } })).toBe(0);
    expect(await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: "AWAITING_APPROVAL", ledgerEntryId: null, version: 2 });
    const [request] = await fx.owner.paymentMatch.findMany({ where: { bankRowId: row.id } });
    expect(request).toMatchObject({ decision: "REQUEST_APPROVAL", flatId: resident.flatId, decidedById: priya.id, approverId: null, reason: REASON });
    expect(request.reasons).toMatchObject({ action: "MATCH", flatCode: resident.flatCode, rememberPayer: true, billId: resident.billId });
    expect(await fx.owner.accountsQueueItem.findFirstOrThrow({ where: { bankRowId: row.id } })).toMatchObject({ status: "OPEN", resolvedAt: null });
    expect(await fx.owner.auditLog.count({ where: { action: "MATCH_APPROVAL_REQUESTED", entityId: row.id } })).toBe(1);
  });

  it("just below the threshold is posted at once", async () => {
    const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
    const row = await queuedRow(fx, 999_999n);
    expect((await match(row, resident.flatCode)).status).toBe("POSTED");
  });

  it("a staff user without payments:match is FORBIDDEN by the service itself", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 100_000n);
    const rahulOnlyApprove = { ...priya, permissions: ["payments:approve"] };
    expect(await match(row, resident.flatCode, { user: rahulOnlyApprove })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
    expect(await match(row, resident.flatCode, { user: { ...priya, active: false } })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
  });
});

describe("MP4 the bill changed after the review: nothing is posted", () => {
  it("a payment committed after the review makes the post a STATE_CHANGED, and the row stays QUEUED", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 646_800n);
    // The reviewer saw ₹6,468 due; then a part payment of ₹1,000 was committed.
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 100_000n, effectiveDate: new Date("2026-10-20T00:00:00Z"), idempotencyKey: `mp4:${resident.billId}` } });
    const before = await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } });
    expect(await match(row, resident.flatCode, { expectedAmountDuePaise: 646_800n })).toEqual({ status: "ERROR", error: "STATE_CHANGED" });
    await nothingChanged(row.id, resident.flatId, before);
  });

  it("a payment dated after the row's date is STATE_CHANGED too, even without an expected amount", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 100_000n, { date: "2026-10-20" });
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 50_000n, effectiveDate: new Date("2026-10-25T00:00:00Z"), idempotencyKey: `mp4b:${resident.billId}` } });
    expect(await match(row, resident.flatCode)).toEqual({ status: "ERROR", error: "STATE_CHANGED" });
  });

  it("with the expected amount unchanged the post goes through", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 646_800n);
    expect((await match(row, resident.flatCode, { expectedAmountDuePaise: 646_800n })).status).toBe("POSTED");
  });
});

describe("MP5 remember payer", () => {
  const vpa = (n: string) => `payer${n}.${Date.now().toString(36)}@oksbi`;
  const known = (flatId: string) => fx.owner.knownPayer.findMany({ where: { flatId, identifierType: "UPI_ID" } });

  it("adds the UPI id once (source MANUAL, added_by the user), and a second row of the same payer adds nothing", async () => {
    const resident = await fx.makeResident({ secondBill: { amountPaise: 700_000n, dueOn: "2026-10-10" } });
    const address = vpa("a");
    const first = await queuedRow(fx, 646_800n, { vpa: address });
    const posted = await match(first, resident.flatCode, { rememberPayer: true });
    expect(posted).toMatchObject({ status: "POSTED", payerNotice: "ADDED" });
    expect((await known(resident.flatId)).map((k) => [k.identifierValue, k.source, k.addedById])).toEqual([[address, "MANUAL", priya.id]]);
    const second = await queuedRow(fx, 100_000n, { vpa: address });
    expect(await match(second, resident.flatCode, { rememberPayer: true })).toMatchObject({ status: "POSTED", payerNotice: "ALREADY_KNOWN" });
    expect(await known(resident.flatId)).toHaveLength(1);
  });

  it("never for a UPI id registered to ANOTHER flat: nothing is inserted and the notice says so, but the payment is still posted", async () => {
    const owner = await fx.makeResident();
    const other = await fx.makeResident();
    const address = vpa("b");
    await fx.owner.knownPayer.create({ data: { flatId: owner.flatId, identifierType: "UPI_ID", identifierValue: address, source: "MANUAL" } });
    const row = await queuedRow(fx, 100_000n, { vpa: address });
    expect(await match(row, other.flatCode, { rememberPayer: true })).toMatchObject({ status: "POSTED", payerNotice: "VPA_ON_OTHER_FLAT" });
    expect(await known(other.flatId)).toHaveLength(0);
    expect(await known(owner.flatId)).toHaveLength(1);
  });

  it("never when nothing was posted (a refusal, and a request awaiting approval), and never when not asked", async () => {
    const paid = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 639_100n }], lateFees: [{ date: "2026-09-20", amountPaise: 2_100n }] });
    const refused = await queuedRow(fx, 5_000n, { vpa: vpa("c") });
    expect(await match(refused, paid.flatCode, { rememberPayer: true })).toEqual({ status: "ERROR", error: "NO_OPEN_BILL" });
    const big = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
    const request = await queuedRow(fx, 2_600_000n, { vpa: vpa("d") });
    expect((await match(request, big.flatCode, { rememberPayer: true })).status).toBe("AWAITING_APPROVAL");
    const quiet = await fx.makeResident();
    const row = await queuedRow(fx, 100_000n, { vpa: vpa("e") });
    expect(await match(row, quiet.flatCode, { rememberPayer: false })).toMatchObject({ status: "POSTED", payerNotice: null });
    for (const flat of [paid, big, quiet]) expect(await known(flat.flatId)).toHaveLength(0);
  });

  it("a row with no UPI id has nothing to remember", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 100_000n);
    expect(await match(row, resident.flatCode, { rememberPayer: true })).toMatchObject({ status: "POSTED", payerNotice: null });
  });
});
