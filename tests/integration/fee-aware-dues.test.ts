import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HomeView } from "@/app/(resident)/home-view";
import { type DueBill, positionsForFlat } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { formatRupees } from "@/domain/money/money";
import { DEMO_NOW } from "@/domain/seed/types";
import { istDateOf } from "@/domain/time/calendar";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { getHomeData } from "@/server/home/home-data";
import { toDueBill, toDueEntry } from "@/server/home/mapper";
import { handleWebhook } from "@/server/payments/handlers";
import { initiatePayment } from "@/server/payments/initiate";
import { applyGatewayEvent, signWebhook } from "@/server/payments/webhook";
import { type PaymentsFixture, type Resident, createPaymentsFixture } from "./payments-fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

/**
 * FA1 to FA3 (FA4, the seeded database, is the HM6 test in home.test.ts): a bill whose principal is paid but whose late fee is not (D107), end to end on a scratch database that holds the demo
 * data, through a client that logs in as the APP role (no new grant). Each test that changes the ledger uses a flat of its own.
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
const TODAY = istDateOf(DEMO_NOW);

/** T21-1601 after a principal-only payment of ₹5,660 on 27 Oct: its PAYMENT and the LATE_FEE of ₹38 a principal-only posting leaves (D110). */
const feeOnlyFlat = (): Promise<Resident> =>
  fx.makeResident({
    billAmountPaise: 1_066_000n,
    dueOn: "2026-10-09",
    payments: [
      { date: "2026-10-12", amountPaise: 500_000n },
      { date: TODAY, amountPaise: 566_000n },
    ],
    lateFees: [{ date: TODAY, amountPaise: 3_800n }],
  });

const home = async (user: { id: string; name: string }) => {
  const data = await getHomeData({ db: fx.app, user: { id: user.id, name: user.name }, now: DEMO_NOW });
  if (data.kind !== "OK") throw new Error("no flat");
  return data;
};
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const start = async (user: { id: string }, expected: bigint) => {
  const result = await initiatePayment({ db: fx.app, user, expectedAmountPaise: expected, now: DEMO_NOW });
  if (result.status !== "CREATED") throw new Error(`no new attempt: ${result.status}`);
  return { attemptId: result.attemptId, reference: `MOCK-${result.attemptId}`, amountPaise: result.amountPaise };
};
const route = () => createGuards(() => ({ db: fx.app, sender: mockOtpSender, now: () => DEMO_NOW })).publicRoute((context) => handleWebhook(context, { env: ENV }));
/** A signed webhook request, through the real route. */
const signedEvent = async (type: "payment.succeeded" | "payment.failed", reference: string, amountPaise: bigint): Promise<Response> => {
  const raw = JSON.stringify({ eventId: `fa-${++eventCounter}`, type, reference, amountPaise: amountPaise.toString() });
  return route()(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { host: "localhost", ...signWebhook(raw, SECRET, DEMO_NOW, ENV) }, body: raw }));
};
const ledgerOf = (flatId: string, entryType: "PAYMENT" | "LATE_FEE") => fx.owner.ledgerEntry.findMany({ where: { flatId, entryType }, orderBy: { createdAt: "asc" } });
const positionOf = async (resident: Resident) => {
  const [bills, entries] = await Promise.all([fx.owner.bill.findMany({ where: { flatId: resident.flatId } }), fx.owner.ledgerEntry.findMany({ where: { flatId: resident.flatId } })]);
  const due: DueBill[] = bills.map(toDueBill);
  return positionsForFlat({ bills: due, entries: entries.map(toDueEntry), policy: defaultLateFeePolicy, asOf: TODAY })[0].position;
};

describe("FA1 principal paid, fee owed: from the Home to a paid fee", () => {
  it("shows the fee as the amount due, locks it, takes ONE PAYMENT and no second LATE_FEE, and the Home then says No dues", async () => {
    const resident = await feeOnlyFlat();
    const user = { id: resident.user.id, name: resident.name };

    const before = await home(user);
    expect(before.dues).toMatchObject({ status: "LATE_FEE_DUE", amountDuePaise: 3_800n });
    expect(before.dues.openBills[0]).toMatchObject({ kind: "FEE_ONLY", feePaise: 3_800n, anomalies: [] });
    expect(text(renderToStaticMarkup(h(HomeView, { data: before })))).toContain("Pay ₹38");

    const attempt = await start(resident.user, 3_800n);
    expect(attempt.amountPaise).toBe(3_800n);
    const response = await signedEvent("payment.succeeded", attempt.reference, 3_800n);
    expect(response.status).toBe(200);

    const withAttempt = await fx.owner.ledgerEntry.findMany({ where: { paymentAttemptId: attempt.attemptId } });
    expect(withAttempt.map((e) => [e.entryType, e.direction, e.amountPaise])).toEqual([["PAYMENT", "PAYMENT", 3_800n]]);
    expect(await ledgerOf(resident.flatId, "LATE_FEE")).toHaveLength(1);
    expect(await ledgerOf(resident.flatId, "PAYMENT")).toHaveLength(3);
    expect(await positionOf(resident)).toMatchObject({ kind: "SETTLED", amountDuePaise: 0n });

    const after = await home(user);
    expect(after.dues).toMatchObject({ status: "ALL_PAID", amountDuePaise: 0n, openBills: [] });
    expect(text(renderToStaticMarkup(h(HomeView, { data: after })))).toContain("No dues");
  });

  it("a principal-only gateway payment on a bill with principal open posts the fee once and leaves a fee-only bill (D110)", async () => {
    const resident = await fx.makeResident({ billAmountPaise: 1_066_000n, dueOn: "2026-10-09", payments: [{ date: "2026-10-12", amountPaise: 500_000n }] });
    const dues = (await home({ id: resident.user.id, name: resident.name })).dues;
    expect(dues.amountDuePaise).toBe(569_800n);
    const attempt = await start(resident.user, 569_800n);
    expect((await signedEvent("payment.succeeded", attempt.reference, 569_800n)).status).toBe(200);
    const posted = await fx.owner.ledgerEntry.findMany({ where: { paymentAttemptId: attempt.attemptId }, orderBy: { entryType: "asc" } });
    expect(posted.map((e) => [e.entryType, e.amountPaise, e.effectiveDate.toISOString().slice(0, 10)])).toEqual([["LATE_FEE", 3_800n, TODAY], ["PAYMENT", 569_800n, TODAY]]);
    expect(await positionOf(resident)).toMatchObject({ kind: "SETTLED" });
  });
});

describe("FA2 a fee paid in two parts, and an amount that is not the locked one", () => {
  it("a first attempt that fails, a part payment, then a second attempt for what remains settles the bill", async () => {
    const resident = await feeOnlyFlat();
    const user = { id: resident.user.id, name: resident.name };
    const first = await start(resident.user, 3_800n);
    expect((await signedEvent("payment.failed", first.reference, 3_800n)).status).toBe(200);
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 1_800n, effectiveDate: new Date(`${TODAY}T00:00:00Z`), idempotencyKey: `fa2-part:${resident.billId}` } });
    expect((await home(user)).dues).toMatchObject({ status: "LATE_FEE_DUE", amountDuePaise: 2_000n });

    const second = await start(resident.user, 2_000n);
    expect(second.amountPaise).toBe(2_000n);
    expect((await signedEvent("payment.succeeded", second.reference, 2_000n)).status).toBe(200);
    expect(await positionOf(resident)).toMatchObject({ kind: "SETTLED", amountDuePaise: 0n });
    expect((await home(user)).dues.status).toBe("ALL_PAID");
  });

  it("a gateway amount that is not the locked amount is an exception: nothing is posted and the bill still owes the fee", async () => {
    const resident = await feeOnlyFlat();
    const attempt = await start(resident.user, 3_800n);
    const outcome = await applyGatewayEvent(fx.app, { eventId: `fa-${++eventCounter}`, type: "payment.succeeded", reference: attempt.reference, amountPaise: 3_700n }, DEMO_NOW);
    expect(outcome).toEqual({ outcome: "EXCEPTION", reason: "AMOUNT_MISMATCH" });
    expect(await fx.owner.ledgerEntry.count({ where: { paymentAttemptId: attempt.attemptId } })).toBe(0);
    expect(await positionOf(resident)).toMatchObject({ kind: "FEE_ONLY", amountDuePaise: 3_800n });
  });

  it("a success for 3,800 after 1,800 of the fee was paid meanwhile is an exception, never an overpayment", async () => {
    const resident = await feeOnlyFlat();
    const attempt = await start(resident.user, 3_800n);
    await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 1_800n, effectiveDate: new Date(`${TODAY}T00:00:00Z`), idempotencyKey: `fa2-meanwhile:${resident.billId}` } });
    expect(await applyGatewayEvent(fx.app, { eventId: `fa-${++eventCounter}`, type: "payment.succeeded", reference: attempt.reference, amountPaise: 3_800n }, DEMO_NOW)).toEqual({ outcome: "EXCEPTION", reason: "AMOUNT_MISMATCH" });
    expect(await positionOf(resident)).toMatchObject({ kind: "FEE_ONLY", amountDuePaise: 2_000n });
  });
});

describe("FA3 the sample flats show the same figures as before this task", () => {
  const ownerHome = async (name: string) => {
    const user = await fx.owner.user.findFirstOrThrow({ where: { name }, select: { id: true, name: true } });
    return home(user);
  };

  it("T12-0408: ₹6,468, 47 days overdue, one bill, Pay ₹6,468", async () => {
    const data = await ownerHome("Swati Joshi");
    expect(data.dues).toMatchObject({ status: "OVERDUE", amountDuePaise: 646_800n, oldest: { overdueDays: 47 } });
    expect(data.dues.openBills.map((b) => b.kind)).toEqual(["PRINCIPAL_OPEN"]);
    const words = text(renderToStaticMarkup(h(HomeView, { data })));
    expect(words).toContain("47 days overdue");
    expect(words).toContain("Pay ₹6,468");
  });

  it("T21-1601: ₹5,698, partly paid, 18 days overdue, Pay ₹5,698", async () => {
    const data = await ownerHome("Aamir Shaikh");
    expect(data.dues).toMatchObject({ status: "PARTLY_PAID", amountDuePaise: 569_800n, oldest: { overdueDays: 18 } });
    expect(data.dues.partlyPaid).toMatchObject({ paidPaise: 500_000n, stillDuePaise: 566_000n, feePaise: 3_800n });
    const words = text(renderToStaticMarkup(h(HomeView, { data })));
    expect(words).toContain("18 days overdue");
    expect(words).toContain("Pay ₹5,698");
  });

  it("T15-0902: two open bills, 47 and 17 days overdue, the label is the oldest bill's amount (D99)", async () => {
    const data = await ownerHome("Rohit Deshmukh");
    expect(data.dues.openBills.map((b) => [b.kind, b.overdueDays])).toEqual([["PRINCIPAL_OPEN", 47], ["PRINCIPAL_OPEN", 17]]);
    const oldest = data.dues.openBills[0];
    const words = text(renderToStaticMarkup(h(HomeView, { data })));
    expect(words).toContain(`Pay oldest bill ${formatRupees(oldest.outstandingPaise + oldest.feePaise)}`);
    expect(data.dues.status).toBe("OVERDUE");
  });
});
