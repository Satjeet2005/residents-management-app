import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type DueBill, type DueEntry, computeDues } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { lockAmount } from "@/domain/payments/amount-lock";
import { type AttemptStatus, type BillPosition, type GatewayAttempt, type GatewayEvent, decideGatewayEvent } from "@/domain/payments/attempt-state";
import { addDays } from "@/domain/time/calendar";

/** mulberry32: a tiny deterministic generator, so a failure can be reproduced from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, max: number) => Math.floor(r() * max);
const pick = <T>(r: () => number, items: readonly T[]): T => items[int(r, items.length)];

const STATUSES: AttemptStatus[] = ["INITIATED", "INITIATED", "INITIATED", "SUCCEEDED", "FAILED", "PROCESSING", "RELEASED"];

type Case = { attempt: GatewayAttempt; event: GatewayEvent; bill: BillPosition };

/** A random case where each guard is, in turn, usually satisfied and sometimes broken. */
function randomCase(r: () => number): Case {
  const principal = BigInt(int(r, 3) === 0 ? 0 : 1 + int(r, 2_000_000));
  const fee = BigInt(int(r, 4) === 0 ? 0 : int(r, 50) * 100);
  const total = principal + fee;
  const lockedOk = int(r, 5) !== 0;
  const amount = lockedOk && total > 0n ? total : BigInt(1 + int(r, 3_000_000));
  const reference = `MOCK-${int(r, 1000)}`;
  return {
    attempt: { id: `a-${int(r, 1000)}`, billId: "b", flatId: "f", status: pick(r, STATUSES), amountPaise: amount, reference, startedOn: addDays("2026-09-01", int(r, 90)) },
    event: { type: pick(r, ["SUCCEEDED", "SUCCEEDED", "FAILED"] as const), amountPaise: int(r, 5) === 0 ? BigInt(1 + int(r, 3_000_000)) : amount, reference: int(r, 8) === 0 ? "MOCK-other" : reference },
    bill: { principalOutstandingAtStartPaise: principal, feeAtStartPaise: fee, hasPaymentAfterStart: int(r, 5) === 0 },
  };
}

/** The rule written out a second time, independently of the code under test. */
function mayPost({ attempt, event, bill }: Case): boolean {
  return (
    attempt.status === "INITIATED" &&
    event.type === "SUCCEEDED" &&
    event.reference === attempt.reference &&
    event.amountPaise === attempt.amountPaise &&
    bill.principalOutstandingAtStartPaise > 0n &&
    attempt.amountPaise === bill.principalOutstandingAtStartPaise + bill.feeAtStartPaise &&
    !bill.hasPaymentAfterStart
  );
}

describe("PY1 properties over 2,000 seeded random cases", () => {
  const cases = (() => {
    const r = seededRandom(20261106);
    return Array.from({ length: 2000 }, () => randomCase(r));
  })();

  it("a POST happens exactly when every guard holds, and in no other case (every failed guard is an EXCEPTION or a safe non-post)", () => {
    for (const c of cases) {
      const decision = decideGatewayEvent(c);
      expect(decision.kind === "POST", JSON.stringify({ ...c, a: String(c.attempt.amountPaise) }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(mayPost(c));
    }
  });

  it("a POST always has exactly one PAYMENT equal to the locked amount and to principal plus fee, and never two payments", () => {
    let posts = 0;
    for (const c of cases) {
      const decision = decideGatewayEvent(c);
      if (decision.kind !== "POST") continue;
      posts++;
      const payments = decision.entries.filter((e) => e.entryType === "PAYMENT");
      expect(payments).toHaveLength(1);
      expect(payments[0].amountPaise).toBe(c.attempt.amountPaise);
      expect(payments[0].amountPaise).toBe(c.bill.principalOutstandingAtStartPaise + c.bill.feeAtStartPaise);
      const fees = decision.entries.filter((e) => e.entryType === "LATE_FEE");
      expect(fees).toHaveLength(c.bill.feeAtStartPaise > 0n ? 1 : 0);
      expect(decision.entries.length).toBe(1 + fees.length);
    }
    expect(posts).toBeGreaterThan(100);
  });

  it("the charges and the payments of a POST balance: the ledger moves by principal, never by more", () => {
    for (const c of cases) {
      const decision = decideGatewayEvent(c);
      if (decision.kind !== "POST") continue;
      const charged = decision.entries.filter((e) => e.direction === "CHARGE").reduce((s, e) => s + e.amountPaise, 0n);
      const paid = decision.entries.filter((e) => e.direction === "PAYMENT").reduce((s, e) => s + e.amountPaise, 0n);
      expect(paid - charged).toBe(c.bill.principalOutstandingAtStartPaise);
    }
  });

  it("every entry of a POST is dated the start day and carries the bill, flat and attempt ids and a distinct idempotency key", () => {
    for (const c of cases) {
      const decision = decideGatewayEvent(c);
      if (decision.kind !== "POST") continue;
      expect(new Set(decision.entries.map((e) => e.idempotencyKey)).size).toBe(decision.entries.length);
      for (const e of decision.entries) {
        expect(e.effectiveDate).toBe(c.attempt.startedOn);
        expect([e.billId, e.flatId, e.paymentAttemptId]).toEqual(["b", "f", c.attempt.id]);
        expect(e.idempotencyKey).toBe(`payment:${c.attempt.id}:${e.entryType}`);
        expect(e.amountPaise).toBeGreaterThan(0n);
      }
    }
  });

  it("a final attempt never posts, and the same event twice is never an exception when the amounts agree", () => {
    for (const c of cases) {
      if (c.attempt.status !== "SUCCEEDED" && c.attempt.status !== "FAILED") continue;
      expect(decideGatewayEvent(c).kind).not.toBe("POST");
    }
  });
});

describe("PY1 property: the lock and the Home agree over 500 seeded random flats", () => {
  it("lockAmount equals the first open bill of computeDues, in paise", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 500; i++) {
      const count = 1 + int(r, 3);
      const bills: DueBill[] = Array.from({ length: count }, (_x, n) => {
        const period = addDays("2026-05-01", n * 30 + int(r, 5));
        return { id: `b${n}`, period, issuedOn: period, dueOn: addDays(period, 9), amountPaise: BigInt(100_000 + int(r, 2_000_000)) };
      });
      const payments: DueEntry[] = Array.from({ length: int(r, 4) }, (_x, n) => ({
        id: `p${n}`,
        entryType: "PAYMENT",
        direction: "PAYMENT",
        amountPaise: BigInt(1_000 + int(r, 900_000)),
        effectiveDate: addDays("2026-05-15", int(r, 160)),
        billId: pick(r, bills).id,
        reversesEntryId: null,
      }));
      const asOf = addDays("2026-08-01", int(r, 120));
      const dues = computeDues({ bills, entries: payments, policy: defaultLateFeePolicy, today: asOf });
      const locked = lockAmount({ openBills: bills, asOf, policy: defaultLateFeePolicy, payments });
      const first = dues.openBills[0];
      if (first === undefined) expect(locked).toBeNull();
      else expect(locked).toEqual({ billId: first.billId, principalPaise: first.outstandingPaise, feePaise: first.feePaise, totalPaise: first.outstandingPaise + first.feePaise });
    }
  });
});

describe("PY1 the payments domain is pure", () => {
  const DIR = path.resolve(process.cwd(), "src/domain/payments");
  const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts")).sort();

  it("holds exactly the two modules", () => {
    expect(FILES).toEqual(["amount-lock.ts", "attempt-state.ts"]);
  });

  it.each(FILES)("%s imports only relative paths inside src/domain, and uses no Node built-in, clock, randomness or Intl", (file) => {
    const source = readFileSync(path.join(DIR, file), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      expect(match[1].startsWith("."), `${file} imports ${match[1]}`).toBe(true);
      expect(path.resolve(DIR, match[1]).startsWith(path.resolve(DIR, ".."))).toBe(true);
    }
    expect(source).not.toMatch(/\bDate\.now\b|new Date\(|Math\.random|\bIntl\b|node:/);
  });
});

describe("PY1 speed", () => {
  it("decides 2,000 events in well under a second", () => {
    const r = seededRandom(1);
    const cases = Array.from({ length: 2000 }, () => randomCase(r));
    const started = performance.now();
    for (const c of cases) decideGatewayEvent(c);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
