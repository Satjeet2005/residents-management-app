import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { computeDues } from "@/domain/billing/dues";
import { decideAccess } from "@/server/auth/access";
import { type SessionUser } from "@/server/auth/session-service";
import { StaffAccessError } from "@/server/statements/ui-data";
import { ageingPageOf } from "@/server/reports/ageing-page";
import { AGE_BUCKETS, ageingFlats } from "@/domain/reports/age";
import { importStatement } from "@/server/statements/import";
import { postManualMatch } from "@/server/statements/manual";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { anonymousCredit, seedStaff } from "./reconciliation-helpers";
import { csv } from "./statements-helpers";
import { DEMO_NOW } from "@/domain/seed/types";
import { toDueBill, toDueEntry } from "@/server/home/mapper";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { loadAgeingPage } from "@/server/reports/ageing-page";
import { loadReportPositions } from "@/server/reports/positions";
import { inPeriod, loadCommitteeReport } from "@/server/reports/report-data";
import { moneyLine } from "@/domain/reports/money-line";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

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
  firstPage = await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", sort: "LARGEST", now: DEMO_NOW });
  secondPage = await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", sort: "LARGEST", cursor: firstPage?.nextCursor ?? undefined, now: DEMO_NOW });
}, 240_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const report = (period: string | null = OCTOBER, now = DEMO_NOW) => loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: period, now });

/** The live payments of a bill as of a date, as raw SQL sees them: PAYMENT entries up to the date that no REVERSAL up to the date cancels. */
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const LIVE_PAYMENTS = `
  SELECT e.bill_id, e.amount_paise FROM ledger_entries e
  WHERE e.entry_type = 'PAYMENT' AND e.direction = 'PAYMENT' AND e.effective_date <= $1::date
    AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= $1::date)`;

/** The open dues by an independent route: principal-open bills and FEE_ONLY bills, each with its age in days, from SQL only ($1 is the as-of date). */
const OPEN_DUES_SQL = `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${LIVE_PAYMENTS}) l GROUP BY bill_id),
         fees AS (SELECT bill_id, sum(amount_paise) AS f FROM ledger_entries WHERE entry_type = 'LATE_FEE' AND direction = 'CHARGE' AND effective_date <= $1::date GROUP BY bill_id),
         open AS (
           SELECT b.id, b.flat_id, b.due_on, b.amount_paise - COALESCE(p.p, 0) AS principal, 0::bigint AS fee_only
           FROM bills b LEFT JOIN paid p ON p.bill_id = b.id WHERE b.issued_on <= $1::date AND COALESCE(p.p, 0) < b.amount_paise
           UNION ALL
           SELECT b.id, b.flat_id, b.due_on, 0::bigint, f.f - (p.p - b.amount_paise)
           FROM bills b JOIN paid p ON p.bill_id = b.id JOIN fees f ON f.bill_id = b.id
           WHERE b.issued_on <= $1::date AND p.p >= b.amount_paise AND f.f - (p.p - b.amount_paise) > 0),
         aged AS (SELECT o.*, ($1::date - o.due_on) AS days,
                    CASE WHEN $1::date - o.due_on <= 0 THEN 'NOT_YET_DUE' WHEN $1::date - o.due_on <= 30 THEN 'DAYS_1_30' WHEN $1::date - o.due_on <= 60 THEN 'DAYS_31_60' WHEN $1::date - o.due_on <= 90 THEN 'DAYS_61_90' ELSE 'OVER_90' END AS bucket
                  FROM open o)`;

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

  it("the pristine seed gives these October figures, which scripts/smoke-app.mjs also expects (as of 27 Oct 2026): a drift in the seed shows here first", () => {
    expect(october.money).toMatchObject({ billedPaise: 1_805_219_000n, collectedPaise: 1_484_271_400n, outstandingPaise: 320_947_600n, flatsBilled: 2399, flatsPaidInFull: 1915, flatsOutstanding: 484 });
    expect(october.ageing.total).toMatchObject({ bills: 943, amountDuePaise: 618_968_600n });
    expect(october.complaints).toMatchObject({ raised: 1603, firstReply: { replied: 1570, medianMinutes: 94, decided: 1573, withinSla: 1369 }, resolved: { count: 1470, medianMinutes: 2186, reopened: 152 }, closed: { byResident: 1001, automatically: 297, byDutyManager: 15, other: 0 }, openNow: 290, safety: { count: 16, closedByDutyManager: 15, openSeen: 0, openNotSeen: 1, closedOtherWay: 0 } });
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
    // D175: the split. The unpaid bills are the principal SQL finds; the late fees are the rest, at least the posted fees still owing.
    expect(data.ageing.total.unpaidBillsPaise).toBe(principalOwed);
    expect(data.ageing.total.unpaidBillsPaise + data.ageing.total.lateFeesPaise).toBe(data.ageing.total.amountDuePaise);
    expect(data.ageing.total.lateFeesPaise >= feeOnlyOwed).toBe(true);

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

  it("the drill-down lists the FLATS of the group, largest first by default, 25 at a time with a cursor, with the group's heading numbers and no name", () => {
    const bucket = october.ageing.buckets.find((b) => b.bucket === "DAYS_31_60");
    expect(bucket?.bills).toBeGreaterThan(50);
    expect(firstPage?.rows).toHaveLength(25);
    expect(firstPage?.nextCursor).not.toBeNull();
    expect(secondPage?.rows).toHaveLength(25);
    const both = [...(firstPage?.rows ?? []), ...(secondPage?.rows ?? [])];
    expect(new Set(both.map((r) => r.flatCode)).size).toBe(50);
    const amounts = both.map((r) => BigInt(r.amountDuePaise));
    expect(amounts).toEqual([...amounts].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect(both.every((r) => r.oldestDaysPastDue >= 31 && r.oldestDaysPastDue <= 60)).toBe(true);
    expect(Object.keys(both[0]).sort()).toEqual(["amountDuePaise", "bills", "flatCode", "oldestDaysPastDue"]);
    expect(firstPage).toMatchObject({ bucket: "DAYS_31_60", sort: "LARGEST", flats: bucket?.flats, amountDuePaise: bucket?.amountDuePaise.toString() });
  });

  it("asking for a bucket in the report returns the same first page as the drill-down loader, from the same positions", async () => {
    const withBucket = await loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: OCTOBER, bucket: "DAYS_31_60", sort: "LARGEST", now: DEMO_NOW });
    expect(withBucket.drilldown).toEqual(firstPage);
    expect(withBucket.ageing).toEqual(october.ageing);
    expect(october.drilldown).toBeNull();
  });

  it("a cursor that is not one, or that belongs to the other order, is refused", async () => {
    expect(await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", sort: "LARGEST", cursor: "not-a-cursor", now: DEMO_NOW })).toBeNull();
    expect(await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", sort: "OLDEST", cursor: firstPage?.nextCursor ?? undefined, now: DEMO_NOW })).toBeNull();
  });

  it("oldest first is a different order of the same flats: the first page starts with the oldest bill, and the flats and the total are the same", async () => {
    const oldest = await loadAgeingPage({ db: fx.app, user: meera, bucket: "DAYS_31_60", sort: "OLDEST", now: DEMO_NOW });
    expect(oldest?.rows[0].oldestDaysPastDue).toBeGreaterThanOrEqual(oldest?.rows.at(-1)?.oldestDaysPastDue ?? 0);
    expect(oldest).toMatchObject({ sort: "OLDEST", flats: firstPage?.flats, amountDuePaise: firstPage?.amountDuePaise });
  });

  it("every group, against an independent SQL: bills, distinct flats, unpaid bills (principal) and the late fees on top, and every flat's bills, oldest age and amount", async () => {
    const groups = await fx.owner.$queryRawUnsafe<{ bucket: string; bills: string; flats: string; principal: string | null; fee_only: string | null }[]>(
      `${OPEN_DUES_SQL} SELECT bucket, count(*)::text AS bills, count(DISTINCT flat_id)::text AS flats, sum(principal)::text AS principal, sum(fee_only)::text AS fee_only FROM aged GROUP BY bucket`,
      AS_OF,
    );
    const perFlat = await fx.owner.$queryRawUnsafe<{ bucket: string; code: string; bills: string; oldest: number; principal: string | null }[]>(
      `${OPEN_DUES_SQL} SELECT a.bucket, f.code, count(*)::text AS bills, max(a.days)::int AS oldest, sum(a.principal)::text AS principal FROM aged a JOIN flats f ON f.id = a.flat_id GROUP BY a.bucket, f.code`,
      AS_OF,
    );
    for (const bucket of october.ageing.buckets) {
      const sql = groups.find((g) => g.bucket === bucket.bucket);
      expect([bucket.bills, bucket.flats], bucket.bucket).toEqual([Number(sql?.bills ?? 0), Number(sql?.flats ?? 0)]);
      expect(bucket.unpaidBillsPaise, bucket.bucket).toBe(BigInt(sql?.principal ?? 0));
      expect(bucket.lateFeesPaise >= BigInt(sql?.fee_only ?? 0), bucket.bucket).toBe(true);
      expect(bucket.unpaidBillsPaise + bucket.lateFeesPaise, bucket.bucket).toBe(bucket.amountDuePaise);
      const flats = ageingFlats(seeded, AS_OF, bucket.bucket, "LARGEST");
      const mine = new Map(perFlat.filter((r) => r.bucket === bucket.bucket).map((r) => [r.code, r]));
      expect(flats.length, bucket.bucket).toBe(mine.size);
      for (const flat of flats) {
        const expected = mine.get(flat.flatCode);
        expect([flat.bills, flat.oldestDaysPastDue], `${bucket.bucket} ${flat.flatCode}`).toEqual([Number(expected?.bills), expected?.oldest]);
        expect(flat.amountDuePaise >= BigInt(expected?.principal ?? 0), `${bucket.bucket} ${flat.flatCode}`).toBe(true);
      }
      expect(flats.reduce((sum, f) => sum + f.amountDuePaise, 0n), bucket.bucket).toBe(bucket.amountDuePaise);
    }
    const totalFlats = await fx.owner.$queryRawUnsafe<{ n: string }[]>(`${OPEN_DUES_SQL} SELECT count(DISTINCT flat_id)::text AS n FROM aged`, AS_OF);
    expect(october.ageing.total.flats).toBe(Number(totalFlats[0].n));
    console.log(`D175 SQL    open flats=${totalFlats[0].n} groups: ${groups.map((g) => `${g.bucket}=${g.bills} bills/${g.flats} flats/${g.principal}`).join(" ")}`);
    console.log(`D175 loader open flats=${october.ageing.total.flats} groups: ${october.ageing.buckets.map((b) => `${b.bucket}=${b.bills} bills/${b.flats} flats/${b.unpaidBillsPaise}`).join(" ")}`);
  });
});

describe("RP7 what is owed by tower, against independent SQL (D182)", () => {
  it("every tower: flats owing, bills, unpaid bills, and flats over 90 days equal SQL; the towers add up to Total owed; no name or flat code in the block", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ tower: string; flats: string; bills: string; principal: string | null; fee_only: string | null; over90: string }[]>(
      `${OPEN_DUES_SQL} SELECT f.tower, count(DISTINCT a.flat_id)::text AS flats, count(*)::text AS bills, sum(a.principal)::text AS principal, sum(a.fee_only)::text AS fee_only,
              count(DISTINCT a.flat_id) FILTER (WHERE a.days >= 91)::text AS over90
       FROM aged a JOIN flats f ON f.id = a.flat_id GROUP BY f.tower`,
      AS_OF,
    );
    const { towers, total } = october.towers;
    expect(towers.length).toBe(rows.length);
    expect(towers.length).toBeGreaterThan(10);
    for (const tower of towers) {
      const sql = rows.find((r) => r.tower === tower.tower);
      expect([tower.flats, tower.bills, tower.flatsOver90], tower.tower).toEqual([Number(sql?.flats), Number(sql?.bills), Number(sql?.over90)]);
      expect(tower.unpaidBillsPaise, tower.tower).toBe(BigInt(sql?.principal ?? 0));
      expect(tower.lateFeesPaise >= BigInt(sql?.fee_only ?? 0), tower.tower).toBe(true);
    }
    expect(towers.map((t) => t.amountDuePaise)).toEqual([...towers.map((t) => t.amountDuePaise)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    // The totals over ALL towers are Total owed, the same figure as the age groups and the card.
    expect(total.amountDuePaise).toBe(october.ageing.total.amountDuePaise);
    expect(towers.reduce((sum, t) => sum + t.amountDuePaise, 0n)).toBe(october.ageing.total.amountDuePaise);
    expect(towers.reduce((sum, t) => sum + t.unpaidBillsPaise, 0n)).toBe(october.ageing.total.unpaidBillsPaise);
    expect(towers.reduce((sum, t) => sum + t.flats, 0)).toBe(october.ageing.total.flats);
    expect(total.flatsOver90).toBe(Number((await fx.owner.$queryRawUnsafe<{ n: string }[]>(`${OPEN_DUES_SQL} SELECT count(DISTINCT flat_id)::text AS n FROM aged WHERE days >= 91`, AS_OF))[0].n));
    console.log(`D182 SQL    towers=${rows.length} top=${[...rows].sort((a, b) => Number(BigInt(b.principal ?? 0) - BigInt(a.principal ?? 0))).slice(0, 3).map((r) => `${r.tower}:${r.principal}`).join(" ")}`);
    console.log(`D182 loader towers=${towers.length} top=${towers.slice(0, 3).map((t) => `${t.tower}:${t.unpaidBillsPaise}/${t.amountDuePaise}`).join(" ")}`);
    const t12 = towers.findIndex((t) => t.tower === "T12");
    console.log(`D182 T12 rank=${t12 + 1} of ${towers.length}, ${JSON.stringify({ ...towers[t12], unpaidBillsPaise: String(towers[t12]?.unpaidBillsPaise), lateFeesPaise: String(towers[t12]?.lateFeesPaise), amountDuePaise: String(towers[t12]?.amountDuePaise) })}; median amount ${towers[Math.floor(towers.length / 2)].amountDuePaise}`);
    const out = renderToStaticMarkup(h(ReportView, { report: october }));
    const block = out.slice(out.indexOf('aria-labelledby="committee-towers"'), out.indexOf("</section>", out.indexOf('aria-labelledby="committee-towers"')));
    expect(block).toContain("Towers with the most unpaid");
    expect(block).not.toMatch(/T\d\d-\d{4}/);
  });
});

describe("RP2 collection quality, checked against raw SQL", () => {
  it("October: the bills due so far, those paid on time, the paid bills and the median days to pay equal a separate SQL query (D134)", async () => {
    const sql = await fx.owner.$queryRawUnsafe<{ due: string; due_on_time: string; on_time: string; paid: string; median_days: string | null }[]>(
      `WITH live AS (
         SELECT e.bill_id, e.effective_date, e.amount_paise FROM ledger_entries e
         WHERE e.entry_type = 'PAYMENT' AND e.direction = 'PAYMENT' AND e.effective_date <= $1::date
           AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= $1::date)),
       run AS (SELECT bill_id, effective_date, sum(amount_paise) OVER (PARTITION BY bill_id ORDER BY effective_date RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum FROM live),
       settled AS (SELECT r.bill_id, min(r.effective_date) AS settled_on FROM run r JOIN bills b ON b.id = r.bill_id WHERE r.cum >= b.amount_paise GROUP BY r.bill_id)
       SELECT (count(*) FILTER (WHERE b.due_on <= $1::date))::text AS due,
              (count(*) FILTER (WHERE b.due_on <= $1::date AND s.settled_on IS NOT NULL AND s.settled_on <= b.due_on))::text AS due_on_time,
              (count(*) FILTER (WHERE s.settled_on IS NOT NULL AND s.settled_on <= b.due_on))::text AS on_time,
              (count(*) FILTER (WHERE s.settled_on IS NOT NULL))::text AS paid,
              (percentile_disc(0.5) WITHIN GROUP (ORDER BY (s.settled_on - b.issued_on)) FILTER (WHERE s.settled_on IS NOT NULL))::text AS median_days
       FROM bills b LEFT JOIN settled s ON s.bill_id = b.id
       WHERE b.period = $2::date AND b.issued_on <= $1::date`,
      AS_OF,
      OCTOBER,
    );
    const q = october.quality;
    console.log(`RP2 SQL    quality due=${sql[0].due} due_on_time=${sql[0].due_on_time} on_time=${sql[0].on_time} paid=${sql[0].paid} median_days=${sql[0].median_days}`);
    console.log(`RP2 loader quality due=${q?.due} due_on_time=${q?.dueOnTime} on_time=${q?.paidOnTime} paid=${q?.paid} median_days=${q?.medianDaysToPay}`);
    expect(String(q?.due)).toBe(sql[0].due);
    expect(String(q?.dueOnTime)).toBe(sql[0].due_on_time);
    expect(String(q?.paidOnTime)).toBe(sql[0].on_time);
    expect(String(q?.paid)).toBe(sql[0].paid);
    expect(q?.paidLate).toBe(Number(sql[0].paid) - Number(sql[0].on_time));
    expect(String(q?.medianDaysToPay)).toBe(String(sql[0].median_days));
  });
});

describe("RP2 complaints, checked against raw SQL", () => {
  it("October: raised, replies, the SLA share, resolved, reopened, closed by whom, open now and the safety figures equal a separate SQL query", async () => {
    const sql = await fx.owner.$queryRawUnsafe<Record<string, string | null>[]>(
      `WITH m AS (SELECT * FROM complaints WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz),
            res AS (SELECT e.complaint_id, min(e.created_at) AS at FROM complaint_events e JOIN m ON m.id = e.complaint_id WHERE e.event_type = 'STATUS_CHANGED' AND e.payload->>'to' = 'PENDING_CONFIRMATION' GROUP BY e.complaint_id),
            ack AS (SELECT e.complaint_id, min(e.created_at) AS at FROM complaint_events e JOIN m ON m.id = e.complaint_id WHERE e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack' GROUP BY e.complaint_id)
       SELECT count(*)::text AS raised,
              (count(*) FILTER (WHERE m.first_response_at IS NOT NULL))::text AS replied,
              (percentile_disc(0.5) WITHIN GROUP (ORDER BY floor(extract(epoch FROM (m.first_response_at - m.created_at)) / 60)) FILTER (WHERE m.first_response_at IS NOT NULL))::text AS median_reply,
              (count(*) FILTER (WHERE m.response_due_at IS NOT NULL AND (m.first_response_at IS NOT NULL OR m.response_due_at < $3::timestamptz)))::text AS decided,
              (count(*) FILTER (WHERE m.first_response_at <= m.response_due_at))::text AS within_sla,
              (count(*) FILTER (WHERE m.first_response_at > m.response_due_at))::text AS replied_late,
              (count(*) FILTER (WHERE m.first_response_at IS NULL AND m.response_due_at < $3::timestamptz))::text AS unreplied_overdue,
              (count(*) FILTER (WHERE m.first_response_at IS NULL AND m.response_due_at >= $3::timestamptz))::text AS not_due,
              count(res.at)::text AS resolved,
              (percentile_disc(0.5) WITHIN GROUP (ORDER BY floor(extract(epoch FROM (res.at - m.created_at)) / 60)) FILTER (WHERE res.at IS NOT NULL))::text AS median_resolved,
              (count(*) FILTER (WHERE res.at IS NOT NULL AND m.reopen_count > 0))::text AS reopened,
              (count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind = 'CONFIRMED'))::text AS by_resident,
              (count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind = 'AUTO_CLOSED'))::text AS auto_closed,
              (count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind = 'DUTY_MANAGER'))::text AS closed_manager,
              (count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind IS NULL))::text AS closed_other,
              (count(*) FILTER (WHERE m.status <> 'CLOSED'))::text AS open_now,
              (count(*) FILTER (WHERE m.safety_flag))::text AS safety,
              (count(*) FILTER (WHERE m.safety_flag AND m.status = 'CLOSED' AND m.close_kind = 'DUTY_MANAGER'))::text AS safety_closed_manager,
              (count(*) FILTER (WHERE m.safety_flag AND m.status <> 'CLOSED' AND ack.at IS NOT NULL))::text AS safety_open_seen,
              (count(*) FILTER (WHERE m.safety_flag AND m.status <> 'CLOSED' AND ack.at IS NULL))::text AS safety_open_unseen,
              (percentile_disc(0.5) WITHIN GROUP (ORDER BY floor(extract(epoch FROM (LEAST(ack.at, CASE WHEN m.status = 'CLOSED' AND m.close_kind = 'DUTY_MANAGER' THEN m.closed_at END) - m.created_at)) / 60)) FILTER (WHERE m.safety_flag AND (ack.at IS NOT NULL OR (m.status = 'CLOSED' AND m.close_kind = 'DUTY_MANAGER'))))::text AS median_seen
       FROM m LEFT JOIN res ON res.complaint_id = m.id LEFT JOIN ack ON ack.complaint_id = m.id`,
      "2026-09-30T18:30:00Z",
      "2026-10-31T18:30:00Z",
      new Date(DEMO_NOW).toISOString(),
    );
    const x = sql[0];
    const c = october.complaints;
    console.log(`RP2 SQL    complaints raised=${x.raised} replied=${x.replied} median_reply=${x.median_reply} decided=${x.decided} within_sla=${x.within_sla} resolved=${x.resolved} median_resolved=${x.median_resolved} reopened=${x.reopened} by_resident=${x.by_resident} auto=${x.auto_closed} by_manager=${x.closed_manager} open_now=${x.open_now} safety=${x.safety} closed_manager=${x.safety_closed_manager} open_seen=${x.safety_open_seen} open_unseen=${x.safety_open_unseen} median_seen=${x.median_seen}`);
    console.log(`RP2 loader complaints raised=${c.raised} replied=${c.firstReply.replied} median_reply=${c.firstReply.medianMinutes} decided=${c.firstReply.decided} within_sla=${c.firstReply.withinSla} resolved=${c.resolved.count} median_resolved=${c.resolved.medianMinutes} reopened=${c.resolved.reopened} by_resident=${c.closed.byResident} auto=${c.closed.automatically} by_manager=${c.closed.byDutyManager} open_now=${c.openNow} safety=${c.safety.count} closed_manager=${c.safety.closedByDutyManager} open_seen=${c.safety.openSeen} open_unseen=${c.safety.openNotSeen} median_seen=${c.safety.medianMinutesToSeen}`);
    expect(c.raised).toBeGreaterThan(100);
    expect(String(c.raised)).toBe(x.raised);
    expect(String(c.firstReply.replied)).toBe(x.replied);
    expect(String(c.firstReply.medianMinutes)).toBe(String(x.median_reply));
    expect(String(c.firstReply.decided)).toBe(x.decided);
    expect(String(c.firstReply.withinSla)).toBe(x.within_sla);
    expect(Number(x.within_sla) + Number(x.replied_late) + Number(x.unreplied_overdue)).toBe(c.firstReply.decided);
    expect(Number(x.within_sla) + Number(x.replied_late) + Number(x.unreplied_overdue) + Number(x.not_due)).toBe(c.raised);
    expect(Number(x.replied_late)).toBeGreaterThan(0);
    console.log(`D150 SQL    replied within the SLA = ${x.within_sla} of ${Number(x.within_sla) + Number(x.replied_late) + Number(x.unreplied_overdue)} (late ${x.replied_late}, unreplied overdue ${x.unreplied_overdue}, not due ${x.not_due})`);
    console.log(`D150 loader replied within the SLA = ${c.firstReply.withinSla} of ${c.firstReply.decided}`);
    expect(String(c.resolved.count)).toBe(x.resolved);
    expect(String(c.resolved.medianMinutes)).toBe(String(x.median_resolved));
    expect(String(c.resolved.reopened)).toBe(x.reopened);
    expect(String(c.closed.byResident)).toBe(x.by_resident);
    expect(String(c.closed.automatically)).toBe(x.auto_closed);
    expect(String(c.openNow)).toBe(x.open_now);
    expect(String(c.safety.count)).toBe(x.safety);
    expect(String(c.closed.byDutyManager)).toBe(x.closed_manager);
    expect(String(c.closed.other)).toBe(x.closed_other);
    expect(c.closed.byResident + c.closed.automatically + c.closed.byDutyManager + c.closed.other + c.openNow).toBe(c.raised);
    expect(String(c.safety.closedByDutyManager)).toBe(x.safety_closed_manager);
    expect(String(c.safety.openSeen)).toBe(x.safety_open_seen);
    expect(String(c.safety.openNotSeen)).toBe(x.safety_open_unseen);
    expect(String(c.safety.medianMinutesToSeen)).toBe(String(x.median_seen));
    expect(c.safety.closedByDutyManager + c.safety.openSeen + c.safety.openNotSeen + c.safety.closedOtherWay).toBe(c.safety.count);
  });

  it("the shares have a denominator, so the page shows percentages and not 'no data' for October", () => {
    expect(october.complaints.firstReply.decided).toBeGreaterThan(0);
    expect(october.complaints.resolved.count).toBeGreaterThan(0);
    expect(october.complaints.safety.count).toBeGreaterThan(0);
    expect(october.quality?.due).toBeGreaterThan(0);
  });
});

describe("RP3 positions: a FEE_ONLY bill, a bill settled late and a part payment, in a month of their own (May 2026)", () => {
  const MAY = "2026-05-01";
  let may: { positions: typeof seeded; over90: typeof firstPage; report: typeof october };
  let april: typeof october;
  const flats: Record<"feeOnly" | "settledLate" | "part", { flatCode: string; billId: string }> = { feeOnly: { flatCode: "", billId: "" }, settledLate: { flatCode: "", billId: "" }, part: { flatCode: "", billId: "" } };

  beforeAll(async () => {
    const feeOnly = await fx.makeResident({ billAmountPaise: 637_000n, dueOn: "2026-05-10", payments: [{ date: "2026-05-20", amountPaise: 637_000n }], lateFees: [{ date: "2026-05-20", amountPaise: 3_800n }] });
    const settledLate = await fx.makeResident({ billAmountPaise: 637_000n, dueOn: "2026-05-10", payments: [{ date: "2026-05-20", amountPaise: 640_800n }], lateFees: [{ date: "2026-05-20", amountPaise: 3_800n }] });
    const part = await fx.makeResident({ billAmountPaise: 1_066_000n, dueOn: "2026-05-10", payments: [{ date: "2026-05-12", amountPaise: 500_000n }] });
    flats.feeOnly = feeOnly;
    flats.settledLate = settledLate;
    flats.part = part;
    // Two payments on one bill, in a month of their own (April 2026): a bill that two payments settle, and one that two payments leave part paid.
    await fx.makeResident({ billAmountPaise: 1_000_000n, dueOn: "2026-04-10", payments: [{ date: "2026-04-05", amountPaise: 400_000n }, { date: "2026-04-08", amountPaise: 600_000n }] });
    await fx.makeResident({ billAmountPaise: 1_000_000n, dueOn: "2026-04-10", payments: [{ date: "2026-04-05", amountPaise: 300_000n }, { date: "2026-04-08", amountPaise: 200_000n }] });
    april = await report("2026-04-01");
    may = { positions: (await loadReportPositions(fx.app, AS_OF)).positions, over90: await loadAgeingPage({ db: fx.app, user: meera, bucket: "OVER_90", sort: "LARGEST", now: DEMO_NOW }), report: await report(MAY) };
  }, 120_000);

  it("the month's money line counts each bill once: Billed, Collected, Outstanding, and the three late-fee figures", () => {
    const money = may.report.money;
    expect(money).toMatchObject({ billedPaise: 637_000n + 637_000n + 1_066_000n, collectedPaise: 637_000n + 637_000n + 500_000n, outstandingPaise: 566_000n, flatsBilled: 3, flatsPaidInFull: 2, flatsOutstanding: 1 });
    expect(money?.fees.postedOwingPaise).toBe(3_800n);
    expect(money?.fees.postedPaidPaise).toBe(3_800n);
    expect(money?.fees.accruingPaise).toBeGreaterThan(0n);
  });

  it("a bill with two payments is one bill: April's two bills are Billed once each, and their four payments add up in Collected", () => {
    expect(april.money).toMatchObject({ billedPaise: 2_000_000n, collectedPaise: 1_500_000n, outstandingPaise: 500_000n, flatsBilled: 2, flatsPaidInFull: 1, flatsOutstanding: 1 });
  });

  it("the FEE_ONLY bill is in the ageing (as an open position aged from its due date) and its fee is the amount due", () => {
    const mine = may.positions.find((p) => p.flatCode === flats.feeOnly.flatCode);
    expect(mine?.position.kind).toBe("FEE_ONLY");
    expect(mine?.position.amountDuePaise).toBe(3_800n);
    // The May bills are the oldest of all (170 days). A fee of ₹38 is the smallest amount, so it ends the largest-first list of "Over 90 days"; it is in the whole list.
    const over90 = ageingFlats(may.positions, AS_OF, "OVER_90", "LARGEST");
    expect(over90.find((r) => r.flatCode === flats.feeOnly.flatCode)).toMatchObject({ bills: 1, oldestDaysPastDue: 170, amountDuePaise: 3_800n });
    expect(over90.at(-1)?.flatCode).toBe(flats.feeOnly.flatCode);
    expect(over90.some((r) => r.flatCode === flats.settledLate.flatCode)).toBe(false);
    expect(may.over90?.flats).toBe(over90.length);
  });

  it("the part-paid bill (T21-1601's shape) owes only what is left, once", () => {
    const mine = may.positions.filter((p) => p.flatCode === flats.part.flatCode);
    expect(mine).toHaveLength(1);
    expect(mine[0].position.principalOutstandingPaise).toBe(566_000n);
  });
});

describe("RP2 speed", () => {
  it("the WHOLE page data (money line, ageing, quality, complaints, reconciliation, goals and a drill-down page) builds on the seeded 2,400-flat database well inside the budget (6 seconds on 2 CPUs; the target is under 2)", async () => {
    const started = performance.now();
    await loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: OCTOBER, bucket: "DAYS_31_60", now: DEMO_NOW });
    const seconds = (performance.now() - started) / 1000;
    console.log(`RP2 the whole page data built in ${seconds.toFixed(2)} s`);
    expect(seconds).toBeLessThan(6);
  });
});


describe("RP2 the goals", () => {
  it("come from the committee_goals setting, each row has a target, the actual in whole percent and Met or Not met worked out on the counts", () => {
    expect(october.goals.source).toBe("SETTING");
    expect(october.goals.rows.map((r) => [r.key, r.targetPercent])).toEqual([["onTimeCollection", 90], ["firstReplyWithinSla", 90], ["reopenedMax", 8]]);
    const q = october.quality;
    const c = october.complaints;
    const [onTime, firstReply, reopened] = october.goals.rows;
    expect(onTime.actualPercent).toBe(Math.round((100 * (q?.dueOnTime ?? 0)) / (q?.due ?? 1)));
    expect(onTime.status).toBe((q?.dueOnTime ?? 0) * 100 >= 90 * (q?.due ?? 1) ? "MET" : "NOT_MET");
    expect(firstReply.status).toBe(c.firstReply.withinSla * 100 >= 90 * c.firstReply.decided ? "MET" : "NOT_MET");
    expect(reopened.status).toBe(c.resolved.reopened * 100 <= 8 * c.resolved.count ? "MET" : "NOT_MET");
    console.log(`RP2 goals ${october.goals.rows.map((r) => `${r.key} target=${r.targetPercent} actual=${r.actualPercent} ${r.status}`).join("; ")}`);
  });

  it("with no committee_goals row the page still opens, on the built-in defaults, and says so", async () => {
    await fx.owner.$executeRaw`DELETE FROM society_settings WHERE key = 'committee_goals'`;
    const without = await loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: OCTOBER, now: DEMO_NOW });
    expect(without.goals.source).toBe("DEFAULT");
    expect(without.goals.rows.map((r) => r.targetPercent)).toEqual([90, 90, 8]);
    await fx.owner.$executeRaw`INSERT INTO society_settings (key, value) VALUES ('committee_goals', '{"onTimeCollectionPercent": 90, "firstReplyWithinSlaPercent": 90, "reopenedPercentMax": 8}'::jsonb)`;
  });
});

describe("RP5 the reconciliation line, after importing the demo statement and posting one manual match", () => {
  let line: Awaited<ReturnType<typeof loadCommitteeReport>>["reconciliation"];
  let sql: { rows: string; auto: string; manual: string; queued: string; awaiting: string; ignored: string; manual_decisions: string; median_minutes: string | null };
  let importId = "";

  beforeAll(async () => {
    const priya = await seedStaff(fx, "5000000001");
    const imported = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "sample-statement.csv", csvText: getSampleStatement(), now: DEMO_NOW });
    if (imported.status !== "IMPORTED") throw new Error(imported.status);
    importId = imported.importId;
    const row = await fx.owner.bankRow.findFirstOrThrow({ where: { importId, narrationRaw: { contains: "710000000003" } } });
    const posted = await postManualMatch({ db: fx.app, user: priya, rowId: row.id, flatCode: "T21-1601", reason: "Owner paid at the branch", rememberPayer: false, expectedVersion: 1, now: DEMO_NOW });
    if (posted.status !== "POSTED") throw new Error(posted.status);
    // An older import (40 days before the business date) is outside the window and must not count.
    const old = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "old.csv", csvText: csv(anonymousCredit(777_000n, { date: "2026-09-10" })), now: DEMO_NOW });
    if (old.status !== "IMPORTED") throw new Error(old.status);
    await fx.owner.$executeRaw`UPDATE statement_imports SET uploaded_at = ${new Date(DEMO_NOW - 40 * 86_400_000)} WHERE id = ${old.importId}::uuid`;
    line = (await loadCommitteeReport({ db: fx.app, user: meera, requestedPeriod: OCTOBER, now: DEMO_NOW })).reconciliation;
    const rows = await fx.owner.$queryRawUnsafe<(typeof sql)[]>(
      `SELECT count(*)::text AS rows,
              (count(*) FILTER (WHERE r.state = 'AUTO_MATCHED'))::text AS auto,
              (count(*) FILTER (WHERE r.state = 'MANUALLY_MATCHED'))::text AS manual,
              (count(*) FILTER (WHERE r.state = 'QUEUED'))::text AS queued,
              (count(*) FILTER (WHERE r.state = 'AWAITING_APPROVAL'))::text AS awaiting,
              (count(*) FILTER (WHERE r.state = 'IGNORED'))::text AS ignored,
              (SELECT count(*) FROM payment_matches m JOIN bank_rows br ON br.id = m.bank_row_id JOIN statement_imports si ON si.id = br.import_id WHERE m.decision = 'MANUAL' AND si.uploaded_at >= $1::timestamptz)::text AS manual_decisions,
              (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY GREATEST(0, floor(extract(epoch FROM (m.decided_at - br.created_at)) / 60))) FROM payment_matches m JOIN bank_rows br ON br.id = m.bank_row_id JOIN statement_imports si ON si.id = br.import_id WHERE m.decision = 'MANUAL' AND si.uploaded_at >= $1::timestamptz)::text AS median_minutes
       FROM bank_rows r JOIN statement_imports i ON i.id = r.import_id WHERE i.uploaded_at >= $1::timestamptz`,
      "2026-09-28T18:30:00Z",
    );
    sql = rows[0];
  }, 120_000);

  it("the rows of the last 30 days by what became of them equal a separate SQL query, and the older import is not in them", () => {
    console.log(`RP5 SQL    rows=${sql.rows} auto=${sql.auto} manual=${sql.manual} queued=${sql.queued} awaiting=${sql.awaiting} ignored=${sql.ignored} manual_decisions=${sql.manual_decisions} median_minutes=${sql.median_minutes}`);
    console.log(`RP5 loader rows=${line.rowsImported} auto=${line.postedAutomatically} manual=${line.postedByHand} queued=${line.waitingForPerson} awaiting=${line.waitingForApproval} ignored=${line.notMaintenance} imports=${line.imports} all_accounted=${line.allAccounted}`);
    expect(String(line.rowsImported)).toBe(sql.rows);
    expect(String(line.postedAutomatically)).toBe(sql.auto);
    expect(String(line.postedByHand)).toBe(sql.manual);
    expect(String(line.waitingForPerson)).toBe(sql.queued);
    expect(String(line.waitingForApproval)).toBe(sql.awaiting);
    expect(String(line.notMaintenance)).toBe(sql.ignored);
    expect(line.rowsImported).toBe(106);
    expect(line.imports).toBe(1);
  });

  it("the demo statement's own counts: 25 posted automatically, 1 by hand, 42 waiting for a person, 38 not maintenance, and the share automatic is 24 percent", () => {
    expect(line).toMatchObject({ postedAutomatically: 25, postedByHand: 1, waitingForPerson: 42, waitingForApproval: 0, notMaintenance: 38 });
    expect(Math.round((100 * line.postedAutomatically) / line.rowsImported)).toBe(24);
  });

  it("every import's rows add up, read back from the database", () => {
    expect(line.allAccounted).toBe(true);
    expect(line.notAccounted).toBe(0);
  });

  it("the manual interventions: one manual match, the median minutes from import to decision as SQL has them, and nothing else", () => {
    const manual = line.interventions.find((i) => i.type === "MANUAL");
    expect(manual?.count).toBe(Number(sql.manual_decisions));
    expect(manual?.count).toBe(1);
    expect(String(manual?.medianMinutes)).toBe(String(sql.median_minutes));
    expect(line.interventions.filter((i) => i.type !== "MANUAL").every((i) => i.count === 0 && i.medianMinutes === null)).toBe(true);
    expect(line.interventions.map((i) => i.type)).toEqual(["MANUAL", "APPROVED", "REJECTED", "IGNORE"]);
  });
});

describe("RP6 access: who may read the report, and what the page never shows", () => {
  const asUser = async (name: string, role: "STAFF" | "RESIDENT"): Promise<Pick<SessionUser, "id" | "role" | "active" | "permissions">> => {
    const user = await fx.owner.user.findFirstOrThrow({ where: { name, role }, select: { id: true, role: true, active: true, permissions: { select: { permission: true } } } });
    return { id: user.id, role: user.role, active: user.active, permissions: user.permissions.map((p) => p.permission) };
  };
  const refused = async (run: () => Promise<unknown>) => expect(await run().then(() => null, (e: unknown) => e)).toBeInstanceOf(StaffAccessError);

  it("a resident, and staff without reports:view, are refused by the loaders at the data", async () => {
    const resident = await fx.owner.user.findFirstOrThrow({ where: { role: "RESIDENT" }, select: { id: true } });
    const residentUser = { id: resident.id, role: "RESIDENT" as const, active: true, permissions: [] as string[] };
    const priya = await asUser("Priya Nair", "STAFF");
    const kavita = await asUser("Kavita Rao", "STAFF");
    for (const user of [residentUser, priya, kavita]) {
      await refused(() => loadCommitteeReport({ db: fx.app, user, requestedPeriod: OCTOBER, now: DEMO_NOW }));
      await refused(() => loadAgeingPage({ db: fx.app, user, bucket: "OVER_90", sort: "LARGEST", now: DEMO_NOW }));
    }
  });

  it("the page rule sends a resident and staff without reports:view to /forbidden, and lets the committee user in", async () => {
    const resident = { id: "r", role: "RESIDENT", active: true, permissions: [] } as unknown as SessionUser;
    const priya = (await asUser("Priya Nair", "STAFF")) as unknown as SessionUser;
    expect(decideAccess(resident, "reports:view")).toEqual({ kind: "forbidden" });
    expect(decideAccess(priya, "reports:view")).toEqual({ kind: "forbidden" });
    expect(decideAccess(null, "reports:view")).toEqual({ kind: "login" });
    expect(decideAccess(meera as unknown as SessionUser, "reports:view").kind).toBe("ok");
  });

  it("the committee user sees the whole page, from the real data, with every block", async () => {
    const out = renderToStaticMarkup(h(ReportView, { report: { ...october, drilldown: firstPage } }));
    for (const part of ["Committee report", "As of 27 October 2026 · read only", "Money collected for October", "Billed and collected", "What is owed", "How fast bills are paid", "Complaints", "Bank statement matching", "About these numbers"]) expect(out).toContain(part);
    expect(words(out)).toMatch(/\d+ flats owe ₹[\d.]+ (lakh|crore) \(31 to 60 days\)/);
    expect(out).not.toMatch(/<h2[^>]*>Goals<\/h2>/);
    expect(out).toContain("₹1,80,52,190");
    expect(out).not.toMatch(/NaN|undefined/);
  });

  it("no resident name or phone number appears anywhere in the page, in any month or any drill-down (every seeded name and phone is searched for)", async () => {
    const people = await fx.owner.user.findMany({ select: { name: true, phone: true } });
    expect(people.length).toBeGreaterThan(2400);
    const pages = AGE_BUCKETS.flatMap((bucket) => (["LARGEST", "OLDEST"] as const).map((sort) => ageingPageOf(seeded, AS_OF, bucket, sort, null)));
    const outputs = pages.map((drilldown) => renderToStaticMarkup(h(ReportView, { report: { ...october, drilldown } })));
    outputs.push(renderToStaticMarkup(h(ReportView, { report: october })));
    expect(outputs.every((out) => out.includes("See the numbers behind this chart") && (out.match(/<table/g) ?? []).length >= 8)).toBe(true);
    const hits = new Set<string>();
    for (const out of outputs) {
      const text = out.replace(/<[^>]*>/g, " ");
      for (const person of people) {
        if (out.includes(person.name) || text.includes(person.name)) hits.add(person.name);
        if (out.includes(person.phone)) hits.add(person.phone);
      }
    }
    expect([...hits]).toEqual([]);
    const data = JSON.stringify([october.ageing, october.money, october.quality, october.complaints, october.reconciliation, firstPage], (_key, value: unknown) => (typeof value === "bigint" ? `paise:${value}` : value));
    expect(people.filter((person) => data.includes(person.phone) || data.includes(person.name)).map((person) => person.name)).toEqual([]);
  });
});
