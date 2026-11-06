import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { initiatePayment } from "@/server/payments/initiate";
import { completeMockPayment, loadMockCheckout } from "@/server/payments/mock-checkout";
import { type PaymentsFixture, type Resident, createPaymentsFixture } from "./payments-fixture";

/** PY7: the demo checkout belongs to its owner, to DEMO_MODE, and goes through the real verify and apply. */
let fx: PaymentsFixture;
beforeAll(async () => {
  fx = await createPaymentsFixture();
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const ENV = { NODE_ENV: "test", DEMO_MODE: "true", PAYMENT_WEBHOOK_SECRET: "mock-checkout-secret-0123456789abcdef" };
const attemptFor = async (resident: Resident) => {
  const result = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW });
  if (result.status !== "CREATED") throw new Error(result.status);
  return result.attemptId;
};

describe("PY7 who may open a demo checkout", () => {
  it("the owner sees the flat, the amount and the status", async () => {
    const mine = await fx.makeResident();
    const attemptId = await attemptFor(mine);
    expect(await loadMockCheckout({ db: fx.app, user: mine.user, attemptId, now: DEMO_NOW, env: ENV })).toEqual({ attemptId, flatCode: mine.flatCode, amountPaise: 646_800n, status: "INITIATED" });
  });

  it("a resident cannot open another flat's checkout: it is exactly as if it did not exist", async () => {
    const mine = await fx.makeResident();
    const theirs = await fx.makeResident();
    const attemptId = await attemptFor(theirs);
    expect(await loadMockCheckout({ db: fx.app, user: mine.user, attemptId, now: DEMO_NOW, env: ENV })).toBeNull();
    expect(await loadMockCheckout({ db: fx.app, user: mine.user, attemptId: crypto.randomUUID(), now: DEMO_NOW, env: ENV })).toBeNull();
  });

  it("a resident cannot complete another flat's payment: NOT_FOUND, and nothing changes", async () => {
    const mine = await fx.makeResident();
    const theirs = await fx.makeResident();
    const attemptId = await attemptFor(theirs);
    expect(await completeMockPayment({ db: fx.app, user: mine.user, attemptId, outcome: "SUCCESS", now: DEMO_NOW, env: ENV })).toBe("NOT_FOUND");
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("INITIATED");
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: theirs.flatId, paymentAttemptId: { not: null } } })).toBe(0);
  });

  it("a person with no flat (a staff user) cannot open any checkout", async () => {
    const staff = await fx.owner.user.create({ data: { phone: "5333333333", name: "Staff", role: "STAFF" } });
    const attemptId = await attemptFor(await fx.makeResident());
    expect(await loadMockCheckout({ db: fx.app, user: staff, attemptId, now: DEMO_NOW, env: ENV })).toBeNull();
  });

  it.each([undefined, "false", "TRUE", "1", ""])("DEMO_MODE=%j: not available even to the owner, and completing does nothing", async (value) => {
    const mine = await fx.makeResident();
    const attemptId = await attemptFor(mine);
    const env = { ...ENV, DEMO_MODE: value };
    expect(await loadMockCheckout({ db: fx.app, user: mine.user, attemptId, now: DEMO_NOW, env })).toBeNull();
    expect(await completeMockPayment({ db: fx.app, user: mine.user, attemptId, outcome: "SUCCESS", now: DEMO_NOW, env })).toBe("NOT_FOUND");
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("INITIATED");
  });
});

describe("PY7 the buttons go through the real verify and apply", () => {
  it("'Pay successfully' posts the late fee and the payment and marks the attempt SUCCEEDED, with an audit row", async () => {
    const mine = await fx.makeResident();
    const attemptId = await attemptFor(mine);
    expect(await completeMockPayment({ db: fx.app, user: mine.user, attemptId, outcome: "SUCCESS", now: DEMO_NOW, env: ENV })).toEqual({ outcome: "POSTED" });
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("SUCCEEDED");
    expect((await fx.owner.ledgerEntry.findMany({ where: { paymentAttemptId: attemptId }, orderBy: { entryType: "asc" } })).map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 9_800n], ["PAYMENT", 646_800n]]);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_SUCCEEDED", entityId: attemptId } })).toBe(1);
    expect(await loadMockCheckout({ db: fx.app, user: mine.user, attemptId, now: DEMO_NOW, env: ENV })).toMatchObject({ status: "SUCCEEDED" });
  });

  it("'Payment fails, no money taken' marks the attempt FAILED and posts nothing", async () => {
    const mine = await fx.makeResident();
    const attemptId = await attemptFor(mine);
    expect(await completeMockPayment({ db: fx.app, user: mine.user, attemptId, outcome: "FAILURE", now: DEMO_NOW, env: ENV })).toEqual({ outcome: "FAILED_MARKED" });
    expect(await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: "FAILED", debitStatus: "NOT_DEBITED" });
    expect(await fx.owner.ledgerEntry.count({ where: { paymentAttemptId: attemptId } })).toBe(0);
  });

  it("pressing a button twice (a double submit) posts once: the second is a DUPLICATE", async () => {
    const mine = await fx.makeResident();
    const attemptId = await attemptFor(mine);
    const press = () => completeMockPayment({ db: fx.app, user: mine.user, attemptId, outcome: "SUCCESS", now: DEMO_NOW, env: ENV });
    const outcomes = await Promise.all([press(), press(), press()]);
    expect(outcomes.filter((o) => o !== "NOT_FOUND" && o.outcome === "POSTED")).toHaveLength(1);
    expect(await fx.owner.ledgerEntry.count({ where: { paymentAttemptId: attemptId } })).toBe(2);
  });

  it("without PAYMENT_WEBHOOK_SECRET it fails closed: it throws and nothing changes", async () => {
    const mine = await fx.makeResident();
    const attemptId = await attemptFor(mine);
    await expect(completeMockPayment({ db: fx.app, user: mine.user, attemptId, outcome: "SUCCESS", now: DEMO_NOW, env: { NODE_ENV: "test", DEMO_MODE: "true" } })).rejects.toThrow(/not set/);
    expect((await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("INITIATED");
  });
});
