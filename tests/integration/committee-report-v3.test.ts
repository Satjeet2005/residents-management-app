import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import { dayStartInstant } from "@/domain/time/calendar";
import { loadCommitteeReport } from "@/server/reports/report-data";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/**
 * Committee report v3 (T14c), the loader through the APP role on the seeded database, run TWICE with the business date injected: 27 October 2026 (the date of the
 * brief) and 8 November 2026 (the date of the live site the audit read). Every new or changed figure is checked against SQL written in this file, which shares no
 * code with the loader: collected within 20 days, the safety and complaint breakdowns, the strip count, the SLA line, what is owed (unpaid bills, late fees, flats)
 * and the towers. The query count must not depend on the date and the page data must be ready in under 3 seconds.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }), saveSections: async () => ({ ok: true, data: "SAVED" }) }));

const OCTOBER = "2026-10-01";
const DATES = ["2026-10-27", "2026-11-08"] as const;
const noonIst = (date: string): number => dayStartInstant(date) + 12 * 3_600_000;
const toPeriod = (d: Date): string => d.toISOString().slice(0, 10);

let fx: PaymentsFixture;
let user: { id: string; role: "STAFF"; active: true; permissions: string[] };

beforeAll(async () => {
  fx = await createPaymentsFixture();
  const row = await fx.owner.user.findFirstOrThrow({ where: { name: "Meera Kapoor" }, select: { id: true, permissions: { select: { permission: true } } } });
  user = { id: row.id, role: "STAFF", active: true, permissions: row.permissions.map((p) => p.permission) };
}, 240_000);
afterAll(async () => {
  await fx?.close();
});

describe.each(DATES)("V3 the committee report as of %s", (asOf) => {
  const now = noonIst(asOf);
  const nowSql = `to_timestamp(${now} / 1000.0)`;
  let report: Awaited<ReturnType<typeof loadCommitteeReport>>;
  let operations = 0;
  let elapsedMs = 0;

  beforeAll(async () => {
    await loadCommitteeReport({ db: fx.app, user, requestedPeriod: OCTOBER, now });
    const counted = fx.app.$extends({
      query: {
        $allOperations({ args, query }) {
          operations += 1;
          return query(args);
        },
      },
    }) as unknown as typeof fx.app;
    const started = performance.now();
    report = await loadCommitteeReport({ db: counted, user, requestedPeriod: OCTOBER, now });
    elapsedMs = performance.now() - started;
  }, 240_000);

  const livePayments = `SELECT e.id, e.bill_id, e.amount_paise, e.effective_date FROM ledger_entries e WHERE e.entry_type = 'PAYMENT' AND e.direction = 'PAYMENT' AND e.effective_date <= DATE '${asOf}'
    AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= DATE '${asOf}')`;

  it("collected within 20 days of the bill, for each of the six months, equals SQL, and a month younger than 20 days is 'so far'", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ period: Date; billed: bigint; within: bigint; issued: Date }[]>(
      `WITH live AS (${livePayments}),
            per_bill AS (
              SELECT b.id, b.period, b.issued_on, b.amount_paise, COALESCE(SUM(l.amount_paise), 0) AS within
              FROM bills b LEFT JOIN live l ON l.bill_id = b.id AND l.effective_date <= LEAST(b.issued_on + 20, DATE '${asOf}')
              WHERE b.issued_on <= DATE '${asOf}' GROUP BY b.id)
       SELECT period, min(issued_on) AS issued, SUM(amount_paise)::bigint AS billed, SUM(LEAST(amount_paise, within))::bigint AS within FROM per_bill GROUP BY period`,
    );
    const byPeriod = new Map(rows.map((r) => [toPeriod(r.period), r]));
    expect(report.series.monthly).toHaveLength(6);
    for (const point of report.series.monthly) {
      const sql = byPeriod.get(point.period);
      expect(point.byDay20Paise, point.period).toBe(sql?.within ?? 0n);
      expect(point.byDay20Percent, point.period).toBe(sql === undefined ? null : Number((200n * sql.within + sql.billed) / (2n * sql.billed)));
      const young = sql !== undefined && new Date(sql.issued).getTime() + 20 * 86_400_000 > dayStartInstant(asOf);
      expect(point.inProgress, point.period).toBe(young);
    }
    console.log(`V3 ${asOf} within 20 days (SQL=loader): ${report.series.monthly.map((p) => `${p.period.slice(0, 7)}:${p.byDay20Percent ?? "-"}%${p.inProgress ? " so far" : ""}`).join(" ")}`);
  }, 60_000);

  it("the complaint counts of October add up and equal SQL: by the resident, automatically, by the duty manager, other, open; and the safety groups", async () => {
    const [x] = await fx.owner.$queryRawUnsafe<Record<string, string>[]>(
      `WITH m AS (SELECT * FROM complaints WHERE created_at >= TIMESTAMPTZ '2026-10-01 00:00+05:30' AND created_at < TIMESTAMPTZ '2026-11-01 00:00+05:30'),
            ack AS (SELECT e.complaint_id, min(e.created_at) AS at FROM complaint_events e JOIN m ON m.id = e.complaint_id WHERE e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack' GROUP BY e.complaint_id)
       SELECT count(*)::text AS raised,
              count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind = 'CONFIRMED')::text AS resident,
              count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind = 'AUTO_CLOSED')::text AS auto,
              count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind = 'DUTY_MANAGER')::text AS manager,
              count(*) FILTER (WHERE m.status = 'CLOSED' AND m.close_kind IS NULL)::text AS other,
              count(*) FILTER (WHERE m.status <> 'CLOSED')::text AS open,
              count(*) FILTER (WHERE m.safety_flag)::text AS safety,
              count(*) FILTER (WHERE m.safety_flag AND m.status = 'CLOSED' AND m.close_kind = 'DUTY_MANAGER')::text AS safety_manager,
              count(*) FILTER (WHERE m.safety_flag AND m.status <> 'CLOSED' AND ack.at IS NOT NULL)::text AS safety_seen,
              count(*) FILTER (WHERE m.safety_flag AND m.status <> 'CLOSED' AND ack.at IS NULL)::text AS safety_unseen
       FROM m LEFT JOIN ack ON ack.complaint_id = m.id`,
    );
    const c = report.complaints;
    expect([c.raised, c.closed.byResident, c.closed.automatically, c.closed.byDutyManager, c.closed.other, c.openNow]).toEqual([x.raised, x.resident, x.auto, x.manager, x.other, x.open].map(Number));
    expect(c.closed.byResident + c.closed.automatically + c.closed.byDutyManager + c.closed.other + c.openNow).toBe(c.raised);
    expect([c.safety.count, c.safety.closedByDutyManager, c.safety.openSeen, c.safety.openNotSeen]).toEqual([x.safety, x.safety_manager, x.safety_seen, x.safety_unseen].map(Number));
    expect(c.safety.closedByDutyManager + c.safety.openSeen + c.safety.openNotSeen + c.safety.closedOtherWay).toBe(c.safety.count);
  });

  it("the strip counts the open safety complaints of ALL months that nobody has acknowledged, and the Complaints section shows the same number", async () => {
    const [sql] = await fx.owner.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM complaints c WHERE c.status <> 'CLOSED' AND c.safety_flag
      AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')`;
    expect(report.safetyUnacknowledged).toBe(sql.n);
    // The line "all months" is in the Complaints section page; the strip is on the overview and on every section page.
    const flat = (markup: string): string => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const section = flat(renderToStaticMarkup(h(SectionPage, { slug: "complaints", report })));
    // D211: the all-months row shows ONLY when it differs from this month's "Open, not yet seen" line; when equal, that line carries the same number.
    if (sql.n === report.complaints.safety.openNotSeen) {
      expect(section).not.toContain("all months");
      if (sql.n > 0) expect(section).toContain(`Open, not yet seen ${sql.n}`);
    } else expect(section).toContain(`Open, not yet seen, all months ${sql.n}`);
    const text = `${flat(renderToStaticMarkup(h(ReportView, { report })))} ${section}`;
    if (sql.n > 0) expect(text).toContain(sql.n === 1 ? "1 safety complaint is open and not yet seen by the duty manager." : `${sql.n} safety complaints are open and not yet seen by the duty manager.`);
    else expect(text).not.toContain("is open and not yet seen by the duty manager");
  });

  it("the Replies card's line is six months of SQL shares and its last point is the card's figure, to the percent", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ month: Date; decided: bigint; met: bigint }[]>(
      `SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')::date AS month,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND (first_response_at IS NOT NULL OR response_due_at < ${nowSql}))::bigint AS decided,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND first_response_at IS NOT NULL AND first_response_at <= response_due_at)::bigint AS met
       FROM complaints GROUP BY 1`,
    );
    const byMonth = new Map(rows.map((r) => [toPeriod(r.month), r]));
    for (const point of report.series.monthlySla) expect([point.decided, point.met], point.period).toEqual([Number(byMonth.get(point.period)?.decided ?? 0n), Number(byMonth.get(point.period)?.met ?? 0n)]);
    expect(report.cards.sla.trend.at(-1)?.value).toBe(report.cards.sla.percent);
    const october = byMonth.get(OCTOBER);
    expect(report.cards.sla.percent).toBe(october === undefined || october.decided === 0n ? null : Number((200n * october.met + october.decided) / (2n * october.decided)));
  });

  it("what is owed: unpaid bills, bills and flats per group, total owed = unpaid bills + late fees, and the towers add up to it, all against SQL", async () => {
    const open = `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${livePayments}) l GROUP BY bill_id),
         fees AS (SELECT bill_id, sum(amount_paise) AS f FROM ledger_entries WHERE entry_type = 'LATE_FEE' AND direction = 'CHARGE' AND effective_date <= DATE '${asOf}' GROUP BY bill_id),
         open AS (
           SELECT b.id, b.flat_id, b.due_on, b.amount_paise - COALESCE(p.p, 0) AS principal, 0::bigint AS fee_only
           FROM bills b LEFT JOIN paid p ON p.bill_id = b.id WHERE b.issued_on <= DATE '${asOf}' AND COALESCE(p.p, 0) < b.amount_paise
           UNION ALL
           SELECT b.id, b.flat_id, b.due_on, 0::bigint, f.f - (p.p - b.amount_paise)
           FROM bills b JOIN paid p ON p.bill_id = b.id JOIN fees f ON f.bill_id = b.id
           WHERE b.issued_on <= DATE '${asOf}' AND p.p >= b.amount_paise AND f.f - (p.p - b.amount_paise) > 0),
         aged AS (SELECT o.*, (DATE '${asOf}' - o.due_on) AS days,
                    CASE WHEN DATE '${asOf}' - o.due_on <= 0 THEN 'NOT_YET_DUE' WHEN DATE '${asOf}' - o.due_on <= 30 THEN 'DAYS_1_30' WHEN DATE '${asOf}' - o.due_on <= 60 THEN 'DAYS_31_60' WHEN DATE '${asOf}' - o.due_on <= 90 THEN 'DAYS_61_90' ELSE 'OVER_90' END AS bucket
                  FROM open o)`;
    const groups = await fx.owner.$queryRawUnsafe<{ bucket: string; bills: string; flats: string; principal: string | null }[]>(`${open} SELECT bucket, count(*)::text AS bills, count(DISTINCT flat_id)::text AS flats, sum(principal)::text AS principal FROM aged GROUP BY bucket`);
    const [all] = await fx.owner.$queryRawUnsafe<{ flats: string; principal: string }[]>(`${open} SELECT count(DISTINCT flat_id)::text AS flats, COALESCE(sum(principal), 0)::text AS principal FROM aged`);
    for (const bucket of report.ageing.buckets) {
      const sql = groups.find((g) => g.bucket === bucket.bucket);
      expect([bucket.bills, bucket.flats], bucket.bucket).toEqual([Number(sql?.bills ?? 0), Number(sql?.flats ?? 0)]);
      expect(bucket.unpaidBillsPaise, bucket.bucket).toBe(BigInt(sql?.principal ?? 0));
    }
    const { total } = report.ageing;
    expect(total.flats).toBe(Number(all.flats));
    expect(total.unpaidBillsPaise).toBe(BigInt(all.principal));
    expect(total.unpaidBillsPaise + total.lateFeesPaise).toBe(total.amountDuePaise);
    expect(report.ageing.buckets.reduce((sum, b) => sum + b.amountDuePaise, 0n)).toBe(total.amountDuePaise);
    expect(report.towers.total.amountDuePaise).toBe(total.amountDuePaise);
    expect(report.towers.towers.reduce((sum, t) => sum + t.amountDuePaise, 0n)).toBe(total.amountDuePaise);
    expect(report.towers.towers.reduce((sum, t) => sum + t.flats, 0)).toBe(total.flats);
    const towers = await fx.owner.$queryRawUnsafe<{ tower: string; flats: string; principal: string }[]>(
      `${open} SELECT f.tower, count(DISTINCT a.flat_id)::text AS flats, COALESCE(sum(a.principal), 0)::text AS principal FROM aged a JOIN flats f ON f.id = a.flat_id GROUP BY f.tower`,
    );
    for (const tower of report.towers.towers) {
      const sql = towers.find((r) => r.tower === tower.tower);
      expect([tower.flats, tower.unpaidBillsPaise], tower.tower).toEqual([Number(sql?.flats), BigInt(sql?.principal ?? 0)]);
    }
    console.log(`V3 ${asOf} owed: total ${total.amountDuePaise} = unpaid ${total.unpaidBillsPaise} + fees ${total.lateFeesPaise}; ${total.flats} different flats; ${towers.length} towers (SQL)`);
  });

  it("D215 the late fees of the Dues page, over ALL months: received and charged-not-yet-paid equal SQL, and with building up they add up to the late fees of the age groups", async () => {
    const [sql] = await fx.owner.$queryRawUnsafe<{ received: string; owing: string }[]>(
      `WITH paid AS (SELECT bill_id, sum(amount_paise) AS p FROM (${livePayments}) l GROUP BY bill_id),
            fees AS (SELECT bill_id, sum(amount_paise) AS f FROM ledger_entries WHERE entry_type = 'LATE_FEE' AND direction = 'CHARGE' AND effective_date <= DATE '${asOf}' GROUP BY bill_id)
       SELECT COALESCE(sum(CASE WHEN p.p >= b.amount_paise THEN p.p - b.amount_paise ELSE 0 END), 0)::text AS received,
              COALESCE(sum(CASE WHEN p.p >= b.amount_paise AND f.f - (p.p - b.amount_paise) > 0 THEN f.f - (p.p - b.amount_paise) ELSE 0 END), 0)::text AS owing
       FROM bills b JOIN paid p ON p.bill_id = b.id LEFT JOIN fees f ON f.bill_id = b.id WHERE b.issued_on <= DATE '${asOf}'`,
    );
    expect(report.lateFees.postedPaidPaise).toBe(BigInt(sql.received));
    expect(report.lateFees.postedOwingPaise).toBe(BigInt(sql.owing));
    expect(report.lateFees.postedOwingPaise + report.lateFees.accruingPaise).toBe(report.ageing.total.lateFeesPaise);
    console.log(`V3 ${asOf} late fees (all months): received ${report.lateFees.postedPaidPaise} (SQL ${sql.received}), charged not paid ${report.lateFees.postedOwingPaise} (SQL ${sql.owing}), building up ${report.lateFees.accruingPaise}; groups hold ${report.ageing.total.lateFeesPaise}`);
  });

  it("the page reads the database a fixed number of times whatever the date, and its data is ready in under 3 seconds", () => {
    console.log(`V3 ${asOf} operations=${operations} elapsed=${Math.round(elapsedMs)}ms`);
    expect(operations).toBeLessThanOrEqual(11);
    expect(elapsedMs).toBeLessThan(3000);
  });
});

describe("V3 the number of queries does not depend on the date", () => {
  it("both dates make the same number of reads", async () => {
    const counts: number[] = [];
    for (const date of DATES) {
      let n = 0;
      const counted = fx.app.$extends({ query: { $allOperations: ({ args, query }) => ((n += 1), query(args)) } }) as unknown as typeof fx.app;
      await loadCommitteeReport({ db: counted, user, requestedPeriod: OCTOBER, now: noonIst(date) });
      counts.push(n);
    }
    expect(counts[0]).toBe(counts[1]);
  }, 120_000);
});
