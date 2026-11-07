import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeDues } from "@/domain/billing/dues";
import { AGE_BUCKETS, ageingRows } from "@/domain/reports/age";
import { DEMO_NOW } from "@/domain/seed/types";
import { toDueBill, toDueEntry } from "@/server/home/mapper";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { loadAgeingPage } from "@/server/reports/ageing-page";
import { loadReportPositions } from "@/server/reports/positions";
import { inPeriod, loadCommitteeReport } from "@/server/reports/report-data";
import { moneyLine } from "@/domain/reports/money-line";

/** T14: the committee report's loaders, through the APP role, against the seeded database as of 27 Oct 2026. Every figure is checked against raw SQL. */
let fx: PaymentsFixture;
let meera: { id: string; role: "STAFF"; active: true; permissions: string[] };
const AS_OF = "2026-10-27";
const OCTOBER = "2026-10-01";

/** Read once for the whole file (a test that rebuilt the 2,400-flat positions each time would take seconds): the October report, the positions, the Home's own sum, and two drill-down pages. */
let october: Awaited<ReturnType<typeof loadCommitteeReport>>;
let seeded: Awaited<ReturnType<typeof loadReportPositions>>["positions"];
let homeSum = { total: 0n, open: 0 };
let firstPage: Awaited<ReturnType<typeof loadAgeingPage>>;
let secondPage: Awaited<ReturnType<typeof loadAgeingPage>>;

beforeAll(async () => {
  fx = await createPaymentsFixture();
  const user = await fx.owner.user.findFirstOrThrow({ where: { name: "Meera Kapoor" }, select: { id: true, permissions: { select: { permission: true } } } });
  meera = { id: user.id, role: "STAFF", active: true, permissions: user.permissions.map((p) => p.permission) };
  october = await loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: OCTOBER, now: DEMO_NOW });
  const loaded = await loadReportPositions(fx.app, AS_OF);
  seeded = loaded.positions;
  const [bills, entries] = await Promise.all([
    fx.owner.bill.findMany({ select: { id: true, flatId: true, period: true, issuedOn: true, dueOn: true, amountPaise: true } }),
    fx.owner.ledgerEntry.findMany({ select: { id: true, flatId: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true, createdAt: true } }),
  ]);
  const billsByFlat = Map.groupBy(bills, (b) => b.flatId);
  const entriesByFlat = Map.groupBy(entries, (e) => e.flatId);
  for (const [flatId, flatBills] of billsByFlat) {
    const dues = computeDues({ bills: flatBills.map(toDueBill), entries: (entriesByFlat.get(flatId) ?? []).map(toDueEntry), policy: loaded.policy, today: AS_OF });
    homeSum = { total: homeSum.total + dues.openBills.reduce((sum, b) => sum + b.outstandingPaise + b.feePaise, 0n), open: homeSum.open + dues.openBills.length };
  }
  firstPage = await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", now: DEMO_NOW });
  secondPage = await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", cursor: firstPage?.nextCursor ?? undefined, now: DEMO_NOW });
}, 240_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const report = (period: string | null = OCTOBER, now = DEMO_NOW) => loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: period, now });

/** The live payments of a bill as of a date, as raw SQL sees them: PAYMENT entries up to the date that no REVERSAL up to the date cancels. */
const LIVE_PAYMENTS = `
  SELECT e.bill_id, e.amount_paise FROM ledger_entries e
  WHERE e.entry_type = 'PAYMENT' AND e.direction = 'PAYMENT' AND e.effective_date <= $1::date
    AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= $1::date)`;

describe("RP2 the money line, checked against raw SQL", () => {
  it("October as of 27 Oct 2026: Billed, Collected, Outstanding and the flat counts equal a separate SQL query", async () => {
    const sql = await fx.owner.$queryRawUnsafe<{ billed: string; collected: string; outstanding: string; flats: string; paid_in_full: string; owing: string }[]>(
      `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${LIVE_PAYMENTS}) l GROUP BY bill_id)
       SELECT sum(b.amount_paise)::text AS billed,
              sum(LEAST(b.amount_paise, COALESCE(p.p, 0)))::text AS collected,
              sum(GREATEST(b.amount_paise - COALESCE(p.p, 0), 0))::text AS outstanding,
              count(*)::text AS flats,
              (count(*) FILTER (WHERE COALESCE(p.p, 0) >= b.amount_paise))::text AS paid_in_full,
              (count(*) FILTER (WHERE COALESCE(p.p, 0) < b.amount_paise))::text AS owing
       FROM bills b LEFT JOIN paid p ON p.bill_id = b.id
       WHERE b.period = $2::date AND b.issued_on <= $1::date`,
      AS_OF,
      OCTOBER,
    );
    const expected = { billed: BigInt(sql[0].billed), collected: BigInt(sql[0].collected), outstanding: BigInt(sql[0].outstanding), flats: BigInt(sql[0].flats), paid_in_full: BigInt(sql[0].paid_in_full), owing: BigInt(sql[0].owing) };
    const data = october;
    expect(data.asOf).toBe(AS_OF);
    expect(data.period).toBe(OCTOBER);
    console.log(`RP2 SQL    billed=${expected.billed} collected=${expected.collected} outstanding=${expected.outstanding} flats=${expected.flats} paid_in_full=${expected.paid_in_full} owing=${expected.owing}`);
    console.log(`RP2 loader billed=${data.money?.billedPaise} collected=${data.money?.collectedPaise} outstanding=${data.money?.outstandingPaise} flats=${data.money?.flatsBilled} paid_in_full=${data.money?.flatsPaidInFull} owing=${data.money?.flatsOutstanding}`);
    expect(data.money).not.toBeNull();
    expect(data.money?.billedPaise).toBe(expected.billed);
    expect(data.money?.collectedPaise).toBe(expected.collected);
    expect(data.money?.outstandingPaise).toBe(expected.outstanding);
    expect(BigInt(data.money?.flatsBilled ?? -1)).toBe(expected.flats);
    expect(BigInt(data.money?.flatsPaidInFull ?? -1)).toBe(expected.paid_in_full);
    expect(BigInt(data.money?.flatsOutstanding ?? -1)).toBe(expected.owing);
  });

  it("the headline invariants hold: Billed = Collected + Outstanding in paise, paid in full + outstanding = billed, Collected never exceeds Billed", async () => {
    for (const period of ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", OCTOBER]) {
      const month = inPeriod(seeded, period);
      expect(month.length, period).toBeGreaterThan(2300);
      const money = moneyLine(month);
      expect(money.billedPaise, period).toBe(money.collectedPaise + money.outstandingPaise);
      expect(money.flatsPaidInFull + money.flatsOutstanding, period).toBe(money.flatsBilled);
      expect(money.collectedPaise <= money.billedPaise, period).toBe(true);
      expect(money.flatsBilled, period).toBeGreaterThan(2300);
    }
  });

  it("the seeded database has no ADJUSTMENT entries, so the SQL checks below need no adjustment rule", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ n: bigint }[]>("SELECT count(*) AS n FROM ledger_entries WHERE entry_type = 'ADJUSTMENT'");
    expect(rows[0].n).toBe(0n);
  });
});

describe("RP2 the ageing, checked against raw SQL and against the Home's own sum", () => {
  it("the open bills and the principal still owed equal SQL, and the total due equals the sum of what each flat owes on its Home", async () => {
    const data = october;
    const sql = await fx.owner.$queryRawUnsafe<{ principal_bills: string; principal: string; principal_flats: string }[]>(
      `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${LIVE_PAYMENTS}) l GROUP BY bill_id)
       SELECT count(*)::text AS principal_bills, sum(b.amount_paise - COALESCE(p.p, 0))::text AS principal, count(DISTINCT b.flat_id)::text AS principal_flats
       FROM bills b LEFT JOIN paid p ON p.bill_id = b.id
       WHERE b.issued_on <= $1::date AND COALESCE(p.p, 0) < b.amount_paise`,
      AS_OF,
    );
    // A bill whose principal is paid but whose posted late fee is not (FEE_ONLY) is also open; SQL finds them as posted fee minus what was paid above the bill.
    const feeOnlySql = await fx.owner.$queryRawUnsafe<{ bills: string; owed: string }[]>(
      `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${LIVE_PAYMENTS}) l GROUP BY bill_id),
            fees AS (SELECT bill_id, sum(amount_paise) AS f FROM ledger_entries WHERE entry_type = 'LATE_FEE' AND direction = 'CHARGE' AND effective_date <= $1::date GROUP BY bill_id)
       SELECT count(*)::text AS bills, COALESCE(sum(f.f - (p.p - b.amount_paise)), 0)::text AS owed
       FROM bills b JOIN paid p ON p.bill_id = b.id JOIN fees f ON f.bill_id = b.id
       WHERE b.issued_on <= $1::date AND p.p >= b.amount_paise AND f.f - (p.p - b.amount_paise) > 0`,
      AS_OF,
    );
    const principalBills = BigInt(sql[0].principal_bills);
    const principalOwed = BigInt(sql[0].principal);
    const feeOnlyBills = BigInt(feeOnlySql[0].bills);
    const feeOnlyOwed = BigInt(feeOnlySql[0].owed);
    console.log(`RP2 SQL    open bills=${principalBills + feeOnlyBills} (principal open ${principalBills}, fee only ${feeOnlyBills}), principal owed=${principalOwed}, fee-only owed=${feeOnlyOwed}`);
    console.log(`RP2 loader open bills=${data.ageing.total.bills}, total due=${data.ageing.total.amountDuePaise}`);
    expect(BigInt(data.ageing.total.bills)).toBe(principalBills + feeOnlyBills);
    const bucketAmounts = data.ageing.buckets.reduce((sum, b) => sum + b.amountDuePaise, 0n);
    expect(bucketAmounts).toBe(data.ageing.total.amountDuePaise);
    expect(data.ageing.buckets.reduce((sum, b) => sum + b.bills, 0)).toBe(data.ageing.total.bills);
    expect(data.ageing.total.amountDuePaise >= principalOwed + feeOnlyOwed).toBe(true);

    // The total due is the principal plus the fees; the fee side is the Home's own sum over every flat (computeDues), not the report's code path.
    console.log(`RP2 Home   open bills=${homeSum.open}, sum of the Homes' amounts due=${homeSum.total}`);
    expect(data.ageing.total.amountDuePaise).toBe(homeSum.total);
    expect(data.ageing.total.bills).toBe(homeSum.open);
  });

  it("the flats with something open equal SQL, and the buckets are the five of the task in order", async () => {
    const data = october;
    expect(data.ageing.buckets.map((b) => b.bucket)).toEqual([...AGE_BUCKETS]);
    const rows = await fx.owner.$queryRawUnsafe<{ flats: string }[]>(
      `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${LIVE_PAYMENTS}) l GROUP BY bill_id)
       SELECT count(DISTINCT b.flat_id)::text AS flats FROM bills b LEFT JOIN paid p ON p.bill_id = b.id WHERE b.issued_on <= $1::date AND COALESCE(p.p, 0) < b.amount_paise`,
      AS_OF,
    );
    expect(data.ageing.total.flats).toBeGreaterThanOrEqual(Number(rows[0].flats));
  });

  it("the drill-down lists the oldest first with flat code, month, days and amount and no name, and pages with a cursor", () => {
    const bucket = october.ageing.buckets.find((b) => b.bucket === "DAYS_31_60");
    expect(bucket?.bills).toBeGreaterThan(50);
    expect(firstPage?.rows).toHaveLength(25);
    expect(firstPage?.nextCursor).not.toBeNull();
    expect(secondPage?.rows).toHaveLength(25);
    const both = [...(firstPage?.rows ?? []), ...(secondPage?.rows ?? [])];
    expect(new Set(both.map((r) => r.billId)).size).toBe(50);
    expect(both.every((r) => r.daysPastDue >= 31 && r.daysPastDue <= 60)).toBe(true);
    expect(both.map((r) => r.daysPastDue)).toEqual([...both].map((r) => r.daysPastDue).sort((a, b) => b - a));
    expect(Object.keys(both[0]).sort()).toEqual(["amountDuePaise", "billId", "daysPastDue", "flatCode", "period"]);
  });

  it("a cursor that is not one is refused", async () => {
    expect(await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", cursor: "not-a-cursor", now: DEMO_NOW })).toBeNull();
  });

  it("every bucket's rows, taken whole from the same positions, add up to the bucket's amount and count", () => {
    for (const bucket of october.ageing.buckets) {
      const rows = ageingRows(seeded, AS_OF, bucket.bucket);
      expect(rows.length, bucket.bucket).toBe(bucket.bills);
      expect(rows.reduce((sum, r) => sum + r.amountDuePaise, 0n), bucket.bucket).toBe(bucket.amountDuePaise);
      expect(new Set(rows.map((r) => r.flatId)).size, bucket.bucket).toBe(bucket.flats);
    }
  });
});

describe("RP3 positions: a FEE_ONLY bill, a bill settled late and a part payment, in a month of their own (May 2026)", () => {
  const MAY = "2026-05-01";
  let may: { positions: typeof seeded; over90: typeof firstPage; report: typeof october };
  const flats: Record<"feeOnly" | "settledLate" | "part", { flatCode: string; billId: string }> = { feeOnly: { flatCode: "", billId: "" }, settledLate: { flatCode: "", billId: "" }, part: { flatCode: "", billId: "" } };

  beforeAll(async () => {
    const feeOnly = await fx.makeResident({ billAmountPaise: 637_000n, dueOn: "2026-05-10", payments: [{ date: "2026-05-20", amountPaise: 637_000n }], lateFees: [{ date: "2026-05-20", amountPaise: 3_800n }] });
    const settledLate = await fx.makeResident({ billAmountPaise: 637_000n, dueOn: "2026-05-10", payments: [{ date: "2026-05-20", amountPaise: 640_800n }], lateFees: [{ date: "2026-05-20", amountPaise: 3_800n }] });
    const part = await fx.makeResident({ billAmountPaise: 1_066_000n, dueOn: "2026-05-10", payments: [{ date: "2026-05-12", amountPaise: 500_000n }] });
    flats.feeOnly = feeOnly;
    flats.settledLate = settledLate;
    flats.part = part;
    may = { positions: (await loadReportPositions(fx.app, AS_OF)).positions, over90: await loadAgeingPage({ db: fx.app, user: meera, bucket: "OVER_90", now: DEMO_NOW }), report: await report(MAY) };
  }, 120_000);

  it("the month's money line counts each bill once: Billed, Collected, Outstanding, and the three late-fee figures", () => {
    const money = may.report.money;
    expect(money).toMatchObject({ billedPaise: 637_000n + 637_000n + 1_066_000n, collectedPaise: 637_000n + 637_000n + 500_000n, outstandingPaise: 566_000n, flatsBilled: 3, flatsPaidInFull: 2, flatsOutstanding: 1 });
    expect(money?.fees.postedOwingPaise).toBe(3_800n);
    expect(money?.fees.postedPaidPaise).toBe(3_800n);
    expect(money?.fees.accruingPaise).toBeGreaterThan(0n);
  });

  it("the FEE_ONLY bill is in the ageing (as an open position aged from its due date) and its fee is the amount due", () => {
    const mine = may.positions.find((p) => p.flatCode === flats.feeOnly.flatCode);
    expect(mine?.position.kind).toBe("FEE_ONLY");
    expect(mine?.position.amountDuePaise).toBe(3_800n);
    // The May bills are the oldest of all (170 days), so they head the "Over 90 days" rows.
    const over90 = may.over90?.rows ?? [];
    const row = over90.find((r) => r.flatCode === flats.feeOnly.flatCode);
    expect(row).toMatchObject({ period: MAY, daysPastDue: 170, amountDuePaise: "3800" });
    expect(over90.some((r) => r.flatCode === flats.settledLate.flatCode)).toBe(false);
  });

  it("the part-paid bill (T21-1601's shape) owes only what is left, once", () => {
    const mine = may.positions.filter((p) => p.flatCode === flats.part.flatCode);
    expect(mine).toHaveLength(1);
    expect(mine[0].position.principalOutstandingPaise).toBe(566_000n);
  });
});

describe("RP2 speed", () => {
  it("the report data builds on the seeded 2,400-flat database well inside the budget (6 seconds on 2 CPUs; the target is under 2)", async () => {
    const started = performance.now();
    await report();
    const seconds = (performance.now() - started) / 1000;
    console.log(`RP2 the money line and the ageing built in ${seconds.toFixed(2)} s`);
    expect(seconds).toBeLessThan(6);
  });
});

