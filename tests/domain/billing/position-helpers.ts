import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import type { BillPositionInput } from "@/domain/billing/position";
import { addDays } from "@/domain/time/calendar";

export const policy = defaultLateFeePolicy;

/** mulberry32: a small deterministic generator, so a failing case can be reproduced from its seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const int = (r: () => number, max: number): number => Math.floor(r() * max);

/** A bill input with nothing paid, nothing posted. */
export const base = (over: Partial<BillPositionInput> = {}): BillPositionInput => ({
  billAmountPaise: 637_000n,
  dueOn: "2026-09-10",
  asOf: "2026-10-27",
  payments: [],
  postedFees: [],
  adjustments: [],
  holds: [],
  policy,
  ...over,
});

/** T21-1601 after its part payment: ₹10,660 due 9 Oct, ₹5,000 paid on 12 Oct. */
export const t21 = (over: Partial<BillPositionInput> = {}): BillPositionInput =>
  base({ billAmountPaise: 1_066_000n, dueOn: "2026-10-09", payments: [{ date: "2026-10-12", amountPaise: 500_000n }], ...over });

/** A random bill with payments (never above the bill plus a little excess) and a fee posted when the principal was paid. */
export function randomInput(r: () => number): BillPositionInput {
  const billAmountPaise = BigInt(100_000 + int(r, 2_000_000));
  const dueOn = addDays("2026-08-10", int(r, 60));
  const payments: { date: string; amountPaise: bigint }[] = [];
  let remaining = billAmountPaise + BigInt(int(r, 3) === 0 ? int(r, 5_000) : 0);
  for (let i = 0; i < int(r, 4) && remaining > 1n; i++) {
    const amountPaise = BigInt(1 + int(r, Number(remaining > 1_000_000n ? 1_000_000n : remaining)));
    payments.push({ date: addDays(dueOn, int(r, 40) - 12), amountPaise });
    remaining -= amountPaise;
  }
  return base({ billAmountPaise, dueOn, asOf: addDays(dueOn, int(r, 80) - 5), payments });
}
