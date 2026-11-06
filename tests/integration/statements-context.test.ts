import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flatContextsFromDataset } from "@/domain/matching/benchmark/population";
import type { FlatContext } from "@/domain/matching/types";
import { generateDemoDataset } from "@/domain/seed/generate";
import { DEMO_NOW } from "@/domain/seed/types";
import { loadMatchContext } from "@/server/statements/context";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/** SI9: the matching context comes from the seeded 2,400-flat database in six queries, as the app role, and equals the dataset's own. */
let fx: PaymentsFixture;
beforeAll(async () => {
  fx = await createPaymentsFixture();
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

/** A client that counts every model query made through it. */
function counting(db: PaymentsFixture["app"]): { db: PaymentsFixture["app"]; calls: () => number } {
  let calls = 0;
  const wrap = (target: object): object =>
    new Proxy(target, {
      get: (t, key) => {
        const value = Reflect.get(t, key) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls++;
          return (value as (...a: unknown[]) => unknown).apply(t, args);
        };
      },
    });
  const proxy = new Proxy(db, {
    get: (t, key) => {
      const value = Reflect.get(t, key) as unknown;
      return typeof key === "string" && !key.startsWith("$") && typeof value === "object" && value !== null ? wrap(value) : typeof value === "function" ? value.bind(t) : value;
    },
  });
  return { db: proxy, calls: () => calls };
}

/** A flat in a shape that does not depend on bill ids or on the order of lists. */
const shape = (flat: FlatContext) => ({
  code: flat.code,
  residents: flat.residents.map((r) => r.name).sort(),
  payers: flat.knownPayers.map((p) => `${p.type}:${p.value}`).sort(),
  bills: flat.openBills.map((b) => ({ amount: b.amountPaise, dueOn: b.dueOn, payments: b.paymentsOnBill.map((p) => `${p.date}:${p.amountPaise}`).sort() })),
});

describe("SI9 loadMatchContext on the seeded database", () => {
  it("uses six queries however many flats there are, and finishes in under 1.5 s", async () => {
    await loadMatchContext(fx.app, DEMO_NOW); // warm the connection and the query plans
    const { db, calls } = counting(fx.app);
    const started = performance.now();
    const context = await loadMatchContext(db, DEMO_NOW);
    const elapsed = performance.now() - started;
    expect(calls()).toBe(6);
    expect(context.flats).toHaveLength(2400);
    expect(elapsed, `${Math.round(elapsed)} ms`).toBeLessThan(1500);
  });

  it("equals the demo dataset's own matching input for every flat (residents, payers, open bills and their payments)", async () => {
    const loaded = await loadMatchContext(fx.app, DEMO_NOW);
    const expected = new Map(flatContextsFromDataset(generateDemoDataset()).map((f) => [f.code, shape(f)]));
    expect(loaded.flats.length).toBe(expected.size);
    const mismatches = loaded.flats.map(shape).filter((f) => JSON.stringify(f, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) !== JSON.stringify(expected.get(f.code), (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(mismatches.map((f) => f.code)).toEqual([]);
  });

  it("T12-0408 has one open bill of ₹6,370 due 10 Sep with its residents; T15-0902 has two, oldest first; T07-1203 has none", async () => {
    const { flats } = await loadMatchContext(fx.app, DEMO_NOW);
    const byCode = new Map(flats.map((f) => [f.code, f]));
    expect(byCode.get("T12-0408")?.openBills.map((b) => [b.amountPaise, b.dueOn])).toEqual([[637_000n, "2026-09-10"]]);
    expect(byCode.get("T12-0408")?.residents.map((r) => r.name).sort()).toEqual(["Anil Joshi", "Swati Joshi"]);
    expect(byCode.get("T15-0902")?.openBills).toHaveLength(2);
    expect(byCode.get("T15-0902")!.openBills[0].dueOn < byCode.get("T15-0902")!.openBills[1].dueOn).toBe(true);
    expect(byCode.get("T07-1203")?.openBills).toEqual([]);
    expect(byCode.get("T21-1601")?.openBills[0].paymentsOnBill).toEqual([{ date: "2026-10-12", amountPaise: 500_000n }]);
  });

  it("reads the policy and the approval threshold from the settings (₹25,000)", async () => {
    const { settings } = await loadMatchContext(fx.app, DEMO_NOW);
    expect(settings.approvalThresholdPaise).toBe(2_500_000n);
    expect(settings.lateFeePolicy).toEqual({ annualRateBps: 1200, capBps: 2100, daysInYear: 365 });
  });

  it("a fully paid bill, a reversed payment, a bill issued later and a resident whose membership ended are handled by the rules", async () => {
    const paid = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 637_000n }] });
    const reversed = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 637_000n }] });
    const payment = await fx.owner.ledgerEntry.findFirstOrThrow({ where: { flatId: reversed.flatId, entryType: "PAYMENT" } });
    await fx.owner.ledgerEntry.create({ data: { flatId: reversed.flatId, billId: reversed.billId, entryType: "REVERSAL", direction: "CHARGE", amountPaise: 637_000n, effectiveDate: new Date("2026-09-25T00:00:00Z"), reversesEntryId: payment.id, idempotencyKey: `ctx-rev:${payment.id}` } });
    const future = await fx.makeResident({ dueOn: "2026-11-10" });
    const gone = await fx.makeResident();
    await fx.owner.flatMember.updateMany({ where: { flatId: gone.flatId }, data: { endsOn: new Date("2026-10-26T00:00:00Z") } });
    const { flats } = await loadMatchContext(fx.app, DEMO_NOW);
    const byCode = new Map(flats.map((f) => [f.code, f]));
    expect(byCode.get(paid.flatCode)?.openBills).toEqual([]);
    expect(byCode.get(reversed.flatCode)?.openBills.map((b) => b.paymentsOnBill)).toEqual([[]]);
    expect(byCode.get(future.flatCode)?.openBills).toEqual([]);
    expect(byCode.get(gone.flatCode)?.residents).toEqual([]);
  });

  it("a missing or invalid setting throws instead of guessing a rule for money", async () => {
    const without = (key: string) =>
      new Proxy(fx.app, {
        get: (t, k) => {
          if (k !== "societySetting") return typeof Reflect.get(t, k) === "function" ? (Reflect.get(t, k) as (...a: unknown[]) => unknown).bind(t) : Reflect.get(t, k);
          return { findMany: async () => (await t.societySetting.findMany({ where: { key: { in: ["late_fee_policy", "approval_threshold_paise"] } }, select: { key: true, value: true } })).filter((s) => s.key !== key) };
        },
      });
    await expect(loadMatchContext(without("approval_threshold_paise"), DEMO_NOW)).rejects.toThrow(/approval_threshold_paise/);
    await expect(loadMatchContext(without("late_fee_policy"), DEMO_NOW)).rejects.toThrow(/late_fee_policy/);
  });
});
