import { describe, expect, it } from "vitest";
import { isRetryableConflict, withDeadlockRetry } from "@/server/db-retry";

const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

describe("D115 withDeadlockRetry", () => {
  it("recognises a deadlock and a serialization failure in the places Prisma and the pg adapter put them", () => {
    expect(isRetryableConflict(deadlock())).toBe(true);
    expect(isRetryableConflict({ code: "40001", message: "x" })).toBe(true);
    expect(isRetryableConflict({ message: "Invalid `prisma.x()`", meta: { driverAdapterError: { cause: { originalCode: "40P01" } } } })).toBe(true);
    expect(isRetryableConflict({ code: "P2034", message: "Transaction failed due to a write conflict or a deadlock" })).toBe(true);
    expect(isRetryableConflict(new Error("lock timeout"))).toBe(false);
    expect(isRetryableConflict(null)).toBe(false);
  });

  it("returns the result at once when nothing fails, without waiting", async () => {
    const { waits, sleep } = noSleep();
    expect(await withDeadlockRetry(async () => 7, { retries: 2, sleep })).toBe(7);
    expect(waits).toEqual([]);
  });

  it("runs the whole work again after a deadlock, with a short wait, and returns the second result", async () => {
    const { waits, sleep } = noSleep();
    let runs = 0;
    const result = await withDeadlockRetry(async () => {
      runs += 1;
      if (runs === 1) throw deadlock();
      return "done";
    }, { retries: 2, sleep });
    expect(result).toBe("done");
    expect(runs).toBe(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(10);
    expect(waits[0]).toBeLessThan(100);
  });

  it("gives up after the retries and throws the deadlock", async () => {
    const { waits, sleep } = noSleep();
    let runs = 0;
    await expect(withDeadlockRetry(async () => { runs += 1; throw deadlock(); }, { retries: 2, sleep })).rejects.toThrow("deadlock detected");
    expect(runs).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it("does not run again for any other error", async () => {
    const { sleep } = noSleep();
    let runs = 0;
    await expect(withDeadlockRetry(async () => { runs += 1; throw new Error("boom"); }, { retries: 2, sleep })).rejects.toThrow("boom");
    expect(runs).toBe(1);
  });
});
