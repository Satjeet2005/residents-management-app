import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDeadlockRetry } from "@/server/db-retry";
import { lockBill, lockBills } from "@/server/payments/bill-lock";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/** D115: two transactions that lock two bills in opposite orders deadlock in Postgres; one is retried and both end consistent. */
let fx: PaymentsFixture;
beforeAll(async () => {
  fx = await createPaymentsFixture();
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

type Bill = { id: string; flatId: string };

/** Posts one PAYMENT to the bill unless it already has one: the second transaction to hold the lock sees the first one's payment. */
async function payOnce(tx: Parameters<Parameters<PaymentsFixture["app"]["$transaction"]>[0]>[0], bill: Bill): Promise<void> {
  const existing = await tx.ledgerEntry.count({ where: { billId: bill.id, entryType: "PAYMENT" } });
  if (existing > 0) return;
  await tx.ledgerEntry.create({
    data: { flatId: bill.flatId, billId: bill.id, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 1000n, effectiveDate: new Date("2026-10-27T00:00:00.000Z"), idempotencyKey: `deadlock:${bill.id}` },
  });
}

describe("D115 a real deadlock on two bills", () => {
  it("is retried exactly once and leaves exactly one PAYMENT per bill", async () => {
    const a = await fx.makeResident();
    const b = await fx.makeResident();
    const first: Bill = { id: a.billId, flatId: a.flatId };
    const second: Bill = { id: b.billId, flatId: b.flatId };

    let arrived = 0;
    let release: () => void = () => undefined;
    const bothHoldTheirFirstLock = new Promise<void>((resolve) => (release = resolve));
    const attempts = { one: 0, two: 0 };
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);

    const run = (counter: "one" | "two", order: [Bill, Bill]) =>
      withDeadlockRetry(
        () =>
          fx.app.$transaction(async (tx) => {
            attempts[counter] += 1;
            await lockBill(tx, order[0].id);
            if (attempts[counter] === 1) {
              arrived += 1;
              if (arrived === 2) release();
              await bothHoldTheirFirstLock;
            }
            await lockBill(tx, order[1].id);
            await payOnce(tx, first);
            await payOnce(tx, second);
          }),
        { retries: 2, sleep },
      );

    await Promise.all([run("one", [first, second]), run("two", [second, first])]);

    expect(attempts.one + attempts.two).toBe(3);
    expect(waits).toHaveLength(1);
    const payments = await fx.owner.ledgerEntry.findMany({ where: { billId: { in: [first.id, second.id] }, entryType: "PAYMENT" } });
    expect(payments.map((p) => p.billId).sort()).toEqual([first.id, second.id].sort());
  });

  it("lockBills takes the bills in sorted order, so opposite requests never deadlock and need no retry", async () => {
    const a = await fx.makeResident();
    const b = await fx.makeResident();
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const run = (ids: string[]) =>
      withDeadlockRetry(
        () =>
          fx.app.$transaction(async (tx) => {
            await lockBills(tx, ids);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }),
        { retries: 2, sleep },
      );
    await Promise.all([run([a.billId, b.billId]), run([b.billId, a.billId, b.billId])]);
    expect(waits).toEqual([]);
  });
});
