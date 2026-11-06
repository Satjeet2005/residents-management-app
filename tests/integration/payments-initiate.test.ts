import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { getHomeData } from "@/server/home/home-data";
import { handleInitiate } from "@/server/payments/handlers";
import { initiatePayment, isUniqueViolation, type InitiateResult } from "@/server/payments/initiate";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/**
 * PY2, PY3 (initiation), PY6 and PY7 (initiation): a payment is started with the amount locked on the oldest open bill,
 * through a client that logs in as the APP role. The clock is injected: 27 Oct 2026, 12:00 India time unless a test moves it.
 */
let fx: PaymentsFixture;
beforeAll(async () => {
  fx = await createPaymentsFixture();
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const DAY = 86_400_000;
const created = (result: InitiateResult) => {
  if (result.status !== "CREATED" && result.status !== "EXISTING") throw new Error(`expected an attempt, got ${result.status}`);
  return result;
};
const start = async (phone: string, expected: bigint, now = DEMO_NOW) => {
  const user = await fx.userByPhone(phone);
  return initiatePayment({ db: fx.app, user, expectedAmountPaise: expected, now });
};
const homeAmount = async (phone: string, now = DEMO_NOW) => {
  const user = await fx.userByPhone(phone);
  const data = await getHomeData({ db: fx.app, user, now });
  if (data.kind !== "OK") throw new Error("no flat");
  return data.dues;
};

describe("PY2 initiating a payment for the sample residents (27 Oct 2026, 12:00 IST), connected as the app role", () => {
  it("T12-0408 (Swati): locks ₹6,468, creates one INITIATED attempt with the gateway reference and the start time, and an audit row", async () => {
    const result = created(await start("5000000007", 646_800n));
    expect(result.status).toBe("CREATED");
    expect(result.amountPaise).toBe(646_800n);
    expect(result.checkoutPath).toBe(`/pay/mock/${result.attemptId}`);
    const row = await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: result.attemptId }, include: { flat: true } });
    expect(row).toMatchObject({ status: "INITIATED", amountPaise: 646_800n, debitStatus: "UNKNOWN", gatewayReference: `MOCK-${result.attemptId}`, resolvedAt: null });
    expect(row.flat.code).toBe("T12-0408");
    expect(row.startedAt.getTime()).toBe(DEMO_NOW);
    const audit = await fx.owner.auditLog.findMany({ where: { action: "PAYMENT_STARTED", entityId: result.attemptId } });
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toEqual({ attemptId: result.attemptId, billId: row.billId, amountPaise: "646800" });
    expect(audit[0].actorId).toBe((await fx.userByPhone("5000000007")).id);
  });

  it("T21-1601 (Aamir, part paid): locks the principal and the fee of the late-fee fixtures, ₹5,660 plus ₹38", async () => {
    const dues = await homeAmount("5000000009");
    expect(dues.openBills[0]).toMatchObject({ outstandingPaise: 566_000n, feePaise: 3_800n });
    const result = created(await start("5000000009", 569_800n));
    expect(result.amountPaise).toBe(569_800n);
    const row = await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: result.attemptId } });
    expect(row.billId).toBe((await fx.owner.bill.findFirstOrThrow({ where: { flat: { code: "T21-1601" } }, orderBy: { dueOn: "desc" } })).id);
  });

  it("T15-0902 (Rohit, two open bills): locks the OLDEST bill only, and the other bill stays open (D99)", async () => {
    const dues = await homeAmount("5000000010");
    expect(dues.openBills).toHaveLength(2);
    const [oldest, newer] = dues.openBills;
    const total = oldest.outstandingPaise + oldest.feePaise;
    expect(total).toBeLessThan(dues.amountDuePaise);
    const result = created(await start("5000000010", total));
    expect(result.amountPaise).toBe(total);
    const row = await fx.owner.paymentAttempt.findUniqueOrThrow({ where: { id: result.attemptId } });
    expect(row.billId).toBe(oldest.billId);
    expect(row.billId).not.toBe(newer.billId);
    expect(await fx.owner.paymentAttempt.count({ where: { billId: newer.billId } })).toBe(0);
  });

  it("T07-1203 (Neeraj, all paid): there is nothing to pay", async () => {
    expect(await start("5000000006", 100n)).toEqual({ status: "NO_DUES" });
    expect(await fx.owner.paymentAttempt.count({ where: { flat: { code: "T07-1203" } } })).toBe(0);
  });

  it("a resident with no flat has nothing to pay", async () => {
    const lonely = await fx.owner.user.create({ data: { phone: "5111111111", name: "No Flat", role: "RESIDENT" } });
    expect(await initiatePayment({ db: fx.app, user: lonely, expectedAmountPaise: 100n, now: DEMO_NOW })).toEqual({ status: "NO_DUES" });
  });
});

describe("PY3 a second tap, a retry or a race never creates a second attempt (D40)", () => {
  it("a second call for the same bill returns the same attempt, unchanged, and writes no second audit row", async () => {
    const resident = await fx.makeResident();
    const first = created(await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW }));
    const second = created(await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW + 5_000 }));
    expect(first.status).toBe("CREATED");
    expect(second).toEqual({ ...first, status: "EXISTING" });
    expect(await fx.owner.paymentAttempt.count({ where: { billId: resident.billId } })).toBe(1);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_STARTED", detail: { path: ["billId"], equals: resident.billId } } })).toBe(1);
  });

  it("twenty parallel initiations return the same attempt id, and exactly one row and one audit row exist", async () => {
    const resident = await fx.makeResident();
    const results = await Promise.all(Array.from({ length: 20 }, () => initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW })));
    const attempts = results.map(created);
    expect(new Set(attempts.map((a) => a.attemptId)).size).toBe(1);
    expect(attempts.filter((a) => a.status === "CREATED")).toHaveLength(1);
    expect(await fx.owner.paymentAttempt.count({ where: { billId: resident.billId } })).toBe(1);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_STARTED", detail: { path: ["billId"], equals: resident.billId } } })).toBe(1);
  });
});

describe("PY3 the loser of a race recognises the database's refusal", () => {
  it("a second unresolved attempt on one bill is refused by the index, and isUniqueViolation recognises the driver's error", async () => {
    const resident = await fx.makeResident();
    const data = (reference: string) => ({ billId: resident.billId, flatId: resident.flatId, amountPaise: 1000n, status: "INITIATED" as const, gatewayReference: reference });
    await fx.app.paymentAttempt.create({ data: data(`MOCK-${crypto.randomUUID()}`) });
    const error = await fx.app.paymentAttempt.create({ data: data(`MOCK-${crypto.randomUUID()}`) }).then(() => null, (e: unknown) => e);
    expect(error).not.toBeNull();
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("PY3 a lost race returns the winner", () => {
  it("when another request inserts the attempt after our check and before our insert, the index refuses ours and we return the winner, with no audit row of ours", async () => {
    const resident = await fx.makeResident();
    const winner = await fx.owner.paymentAttempt.create({ data: { billId: resident.billId, flatId: resident.flatId, amountPaise: 646_800n, status: "INITIATED", gatewayReference: `MOCK-${crypto.randomUUID()}` } });
    // The first "is there an unresolved attempt?" read does not see the winner yet (the race), every later read does.
    let blind = true;
    const attempts = new Proxy(fx.app.paymentAttempt, {
      get: (target, key) => {
        const value = Reflect.get(target, key) as unknown;
        if (key !== "findFirst" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return (args: unknown) => {
          if (!blind) return value.call(target, args);
          blind = false;
          return Promise.resolve(null);
        };
      },
    });
    const racing = new Proxy(fx.app, {
      get: (target, key) => {
        if (key === "paymentAttempt") return attempts;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = created(await initiatePayment({ db: racing, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW }));
    expect(blind).toBe(false);
    expect(result.status).toBe("EXISTING");
    expect(result.attemptId).toBe(winner.id);
    expect(await fx.owner.paymentAttempt.count({ where: { billId: resident.billId } })).toBe(1);
    expect(await fx.owner.auditLog.count({ where: { action: "PAYMENT_STARTED", detail: { path: ["billId"], equals: resident.billId } } })).toBe(0);
  });
});

describe("PY6 a stale amount is refused with the new amount (D101)", () => {
  it("the same expected amount on the next day is AMOUNT_CHANGED with the larger amount, and nothing is created", async () => {
    const resident = await fx.makeResident();
    const today = created(await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW }));
    await fx.owner.paymentAttempt.update({ where: { id: today.attemptId }, data: { status: "FAILED", debitStatus: "NOT_DEBITED", resolvedAt: new Date(DEMO_NOW) } });
    const tomorrow = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_800n, now: DEMO_NOW + DAY });
    expect(tomorrow.status).toBe("AMOUNT_CHANGED");
    if (tomorrow.status !== "AMOUNT_CHANGED") return;
    expect(tomorrow.amountPaise).toBeGreaterThan(646_800n);
    expect(await fx.owner.paymentAttempt.count({ where: { billId: resident.billId } })).toBe(1);
    const retry = created(await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: tomorrow.amountPaise, now: DEMO_NOW + DAY }));
    expect(retry.status).toBe("CREATED");
    expect(retry.amountPaise).toBe(tomorrow.amountPaise);
    expect(retry.attemptId).not.toBe(today.attemptId);
  });

  it("an amount that is off by one paise, either way, is AMOUNT_CHANGED", async () => {
    const resident = await fx.makeResident();
    expect((await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_799n, now: DEMO_NOW })).status).toBe("AMOUNT_CHANGED");
    expect((await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: 646_801n, now: DEMO_NOW })).status).toBe("AMOUNT_CHANGED");
    expect(await fx.owner.paymentAttempt.count({ where: { billId: resident.billId } })).toBe(0);
  });

  it("the locked amount is the Home's amount for the oldest bill, on every date of a fortnight", async () => {
    const resident = await fx.makeResident({ secondBill: { amountPaise: 700_000n, dueOn: "2026-10-10" } });
    for (let offset = 0; offset < 14; offset++) {
      const now = DEMO_NOW + offset * DAY;
      const data = await getHomeData({ db: fx.app, user: { id: resident.user.id, name: "x" }, now });
      if (data.kind !== "OK") throw new Error("no flat");
      const oldest = data.dues.openBills[0];
      const result = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: oldest.outstandingPaise + oldest.feePaise + 1n, now });
      expect(result, `day +${offset}`).toEqual({ status: "AMOUNT_CHANGED", amountPaise: oldest.outstandingPaise + oldest.feePaise });
    }
  });
});

describe("PY7 who may start a payment, and when (the route, with the real guard)", () => {
  const guards = () => createGuards(() => ({ db: fx.app, sender: mockOtpSender, now: () => DEMO_NOW }));
  const post = async (cookie: string | null, body: unknown, env: Record<string, string | undefined>) => {
    const route = guards().withPermission("RESIDENT", (context) => handleInitiate(context, { env, now: DEMO_NOW }));
    const headers: Record<string, string> = { "content-type": "application/json", host: "localhost" };
    if (cookie !== null) headers.cookie = cookie;
    return route(new Request("http://localhost/api/payments", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
  };
  const demo = { DEMO_MODE: "true" };

  it("a resident gets 200 with the attempt id, the checkout path and the amount as a decimal string", async () => {
    const resident = await fx.makeResident();
    const cookie = await fx.signIn(resident.user.id, "RESIDENT", DEMO_NOW);
    const response = await post(cookie, { expectedAmountPaise: "646800" }, demo);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ attemptId: expect.any(String), checkoutPath: `/pay/mock/${body.attemptId}`, amountPaise: "646800" });
  });

  it("a stale amount is 409 AMOUNT_CHANGED with the new amount as a string", async () => {
    const resident = await fx.makeResident();
    const cookie = await fx.signIn(resident.user.id, "RESIDENT", DEMO_NOW);
    const response = await post(cookie, { expectedAmountPaise: "1000" }, demo);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "AMOUNT_CHANGED", amountPaise: "646800" });
  });

  it("nothing open is 409 NO_DUES", async () => {
    const paid = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 637_000n }] });
    const response = await post(await fx.signIn(paid.user.id, "RESIDENT", DEMO_NOW), { expectedAmountPaise: "1000" }, demo);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "NO_DUES" });
  });

  it("a staff user cannot call it: 403 FORBIDDEN, and no attempt is made", async () => {
    const staff = await fx.owner.user.create({ data: { phone: "5222222222", name: "Staff", role: "STAFF" } });
    const before = await fx.owner.paymentAttempt.count();
    const response = await post(await fx.signIn(staff.id, "STAFF", DEMO_NOW), { expectedAmountPaise: "646800" }, demo);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
    expect(await fx.owner.paymentAttempt.count()).toBe(before);
  });

  it("no session is 401", async () => {
    const response = await post(null, { expectedAmountPaise: "646800" }, demo);
    expect(response.status).toBe(401);
  });

  it.each([undefined, "false", "TRUE", "True", "1", "yes", ""])("DEMO_MODE=%j is 503 PAYMENT_PROVIDER_NOT_CONFIGURED and creates nothing", async (value) => {
    const resident = await fx.makeResident();
    const response = await post(await fx.signIn(resident.user.id, "RESIDENT", DEMO_NOW), { expectedAmountPaise: "646800" }, { DEMO_MODE: value });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
    expect(await fx.owner.paymentAttempt.count({ where: { billId: resident.billId } })).toBe(0);
  });

  it.each([
    ["a number, not a string", { expectedAmountPaise: 646800 }],
    ["a negative amount", { expectedAmountPaise: "-1" }],
    ["a fraction", { expectedAmountPaise: "6468.5" }],
    ["an empty string", { expectedAmountPaise: "" }],
    ["sixteen digits", { expectedAmountPaise: "1234567890123456" }],
    ["a missing field", {}],
    ["an array", []],
    ["not JSON", "{nope"],
  ])("a bad body (%s) is 400 INVALID_REQUEST", async (_label, body) => {
    const resident = await fx.makeResident();
    const response = await post(await fx.signIn(resident.user.id, "RESIDENT", DEMO_NOW), body, demo);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("an extra field in the body, such as a flat or a bill, is ignored: the flat is always the person's own", async () => {
    const mine = await fx.makeResident();
    const other = await fx.makeResident();
    const response = await post(await fx.signIn(mine.user.id, "RESIDENT", DEMO_NOW), { expectedAmountPaise: "646800", flatId: other.flatId, billId: other.billId }, demo);
    expect(response.status).toBe(200);
    expect(await fx.owner.paymentAttempt.count({ where: { billId: other.billId } })).toBe(0);
    expect(await fx.owner.paymentAttempt.count({ where: { billId: mine.billId } })).toBe(1);
  });
});
