import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DueBill, type DueEntry, positionsForFlat } from "@/domain/billing/dues";
import { defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { DEMO_NOW } from "@/domain/seed/types";
import { istDateOf } from "@/domain/time/calendar";
import { toDueBill } from "@/server/home/mapper";
import { importStatement, type ImportHooks } from "@/server/statements/import";
import { loadMatchContext } from "@/server/statements/context";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { DUE_ON_27_OCT, csv, upiRow } from "./statements-helpers";

/**
 * The bank import and bills whose principal is paid but whose late fee is not (D107). The matcher is not told about such a bill
 * (a documented limit); the re-validation inside the transaction reads positions. Run as the APP role on a scratch database.
 */
let fx: PaymentsFixture;
let staffId: string;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  staffId = (await fx.userByPhone("5000000001")).id;
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const imported = async (csvText: string, hooks?: ImportHooks) => {
  const result = await importStatement({ db: fx.app, user: { id: staffId }, filename: "statement.csv", csvText, now: DEMO_NOW, hooks });
  if (result.status !== "IMPORTED") throw new Error(`expected IMPORTED, got ${result.status}`);
  return result;
};
const rowsOf = (importId: string) => fx.owner.bankRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" } });
/** What a principal-only payment of the whole bill leaves in the ledger on 27 Oct: PAYMENT ₹6,370 and LATE_FEE ₹98 (D110). */
const FEE_ONLY = { payments: [{ date: "2026-10-27", amountPaise: 637_000n }], lateFees: [{ date: "2026-10-27", amountPaise: 9_800n }] };

describe("FA5 the matcher does not see a bill whose principal is paid", () => {
  it("a bank payment for a fee-only bill is queued as NO_OPEN_BILL for a person, and posts nothing", async () => {
    const resident = await fx.makeResident(FEE_ONLY);
    const before = await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } });
    const result = await imported(csv(upiRow(resident, 9_800n)));
    expect(result.summary).toMatchObject({ autoMatched: 0, queued: 1 });
    const [row] = await rowsOf(result.importId);
    expect(row.state).toBe("QUEUED");
    expect((row.parsed as { decision: { reasons: { code: string }[] } }).decision.reasons.map((r) => r.code)).toContain("NO_OPEN_BILL");
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId } })).toBe(before);
  });

  it("the match context holds exactly the bills whose position is PRINCIPAL_OPEN, for every flat of the database", async () => {
    await fx.makeResident(FEE_ONLY);
    await fx.makeResident({ payments: [{ date: "2026-10-12", amountPaise: 100_000n }] });
    const context = await loadMatchContext(fx.owner, DEMO_NOW);
    const [flats, bills, entries] = await Promise.all([
      fx.owner.flat.findMany({ select: { id: true, code: true } }),
      fx.owner.bill.findMany({ select: { id: true, flatId: true, period: true, issuedOn: true, dueOn: true, amountPaise: true } }),
      fx.owner.ledgerEntry.findMany({ select: { id: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true } }),
    ]);
    const due: DueEntry[] = entries.map((e) => ({ ...e, effectiveDate: e.effectiveDate.toISOString().slice(0, 10) }));
    const billsByFlat = Map.groupBy(bills, (b) => b.flatId);
    let feeOnly = 0;
    for (const flat of flats) {
      const mine: DueBill[] = (billsByFlat.get(flat.id) ?? []).map(toDueBill);
      const positions = positionsForFlat({ bills: mine, entries: due.filter((e) => e.billId === null || mine.some((b) => b.id === e.billId)), policy: defaultLateFeePolicy, asOf: istDateOf(DEMO_NOW) });
      const principalOpen = positions.filter((p) => p.position.kind === "PRINCIPAL_OPEN").map((p) => p.bill.id).sort();
      feeOnly += positions.filter((p) => p.position.kind === "FEE_ONLY").length;
      const seen = (context.flats.find((f) => f.code === flat.code)?.openBills ?? []).map((b) => b.billKey).sort();
      expect(seen, flat.code).toEqual(principalOpen);
    }
    expect(feeOnly).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("FA5 the posting is re-validated by position inside the transaction", () => {
  it("a bill that became FEE_ONLY after the snapshot downgrades the row to QUEUED with STATE_CHANGED and posts nothing from the bank", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)), {
      afterSnapshot: async () => {
        await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 637_000n, effectiveDate: new Date("2026-10-27T00:00:00Z"), idempotencyKey: `fa5-pay:${resident.billId}` } });
        await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "LATE_FEE", direction: "CHARGE", amountPaise: 9_800n, effectiveDate: new Date("2026-10-27T00:00:00Z"), idempotencyKey: `fa5-fee:${resident.billId}` } });
      },
    });
    expect(result.summary).toMatchObject({ autoMatched: 0, queued: 1, downgraded: 1 });
    const [row] = await rowsOf(result.importId);
    expect((row.parsed as { decision: { reasons: { code: string }[] } }).decision.reasons.map((r) => r.code)).toContain("STATE_CHANGED");
    expect(await fx.owner.ledgerEntry.count({ where: { bankRow: { importId: result.importId } } })).toBe(0);
  });

  it("an equals-due payment is still posted as a LATE_FEE and one PAYMENT, exactly what planPosting plans", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)));
    expect(result.summary).toMatchObject({ autoMatched: 1, downgraded: 0 });
    const entries = await fx.owner.ledgerEntry.findMany({ where: { flatId: resident.flatId, entryType: { in: ["LATE_FEE", "PAYMENT"] } }, orderBy: { entryType: "asc" } });
    expect(entries.map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 9_800n], ["PAYMENT", 646_800n]]);
  });
});
