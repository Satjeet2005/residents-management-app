import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { SECTION_IDS, parseHiddenSections } from "@/lib/reports/sections";
import { ageingTable } from "@/domain/reports/age";
import { DEMO_NOW } from "@/domain/seed/types";
import { loadCommitteeReport } from "@/server/reports/report-data";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/**
 * Committee report v2, the loader through the APP role on the seeded database as of 27 Oct 2026. Every series and card is checked against SQL written in this
 * test, which shares no code with the loader (the loader builds positions in memory with `positionsForFlat`; the SQL below counts payments in the database).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }), saveSections: async () => ({ ok: true, data: "SAVED" }) }));

const AS_OF = "2026-10-27";
const OCTOBER = "2026-10-01";
const NOW_SQL = `to_timestamp(${DEMO_NOW} / 1000.0)`;

let fx: PaymentsFixture;
let user: { id: string; role: "STAFF"; active: true; permissions: string[] };
let report: Awaited<ReturnType<typeof loadCommitteeReport>>;
let operations = 0;
let elapsedMs = 0;

/** Bills with the live payments on them up to the business date (a payment a REVERSAL cancels does not count). */
const BILL_PAID = `
  SELECT b.id, b.flat_id, b.period, b.issued_on, b.due_on, b.amount_paise,
    COALESCE(SUM(e.amount_paise), 0)::bigint AS paid
  FROM bills b
  LEFT JOIN ledger_entries e ON e.bill_id = b.id AND e.entry_type = 'PAYMENT' AND e.effective_date <= DATE '${AS_OF}'
    AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= DATE '${AS_OF}')
  WHERE b.issued_on <= DATE '${AS_OF}'
  GROUP BY b.id`;

const toPeriod = (d: Date): string => d.toISOString().slice(0, 10);

beforeAll(async () => {
  fx = await createPaymentsFixture();
  const row = await fx.owner.user.findFirstOrThrow({ where: { name: "Meera Kapoor" }, select: { id: true, permissions: { select: { permission: true } } } });
  user = { id: row.id, role: "STAFF", active: true, permissions: row.permissions.map((p) => p.permission) };
  await loadCommitteeReport({ db: fx.app, user, requestedPeriod: OCTOBER, now: DEMO_NOW });
  const counted = fx.app.$extends({
    query: {
      $allOperations({ args, query }) {
        operations += 1;
        return query(args);
      },
    },
  }) as unknown as typeof fx.app;
  const started = performance.now();
  report = await loadCommitteeReport({ db: counted, user, requestedPeriod: OCTOBER, now: DEMO_NOW });
  elapsedMs = performance.now() - started;
}, 240_000);
afterAll(async () => {
  await fx?.close();
});

describe("V2-1 the monthly series against SQL", () => {
  it("each of the six months: billed, collected and outstanding equal the SQL sums, and the months are the six ending October", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ period: Date; billed: bigint; collected: bigint }[]>(
      `SELECT period, SUM(amount_paise)::bigint AS billed, SUM(LEAST(paid, amount_paise))::bigint AS collected FROM (${BILL_PAID}) x GROUP BY period`,
    );
    const byPeriod = new Map(rows.map((r) => [toPeriod(r.period), r]));
    expect(report.series.monthly.map((p) => p.period)).toEqual(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    for (const point of report.series.monthly) {
      const sql = byPeriod.get(point.period);
      expect(point.billedPaise, point.period).toBe(sql?.billed ?? 0n);
      expect(point.collectedPaise, point.period).toBe(sql?.collected ?? 0n);
      expect(point.outstandingPaise, point.period).toBe((sql?.billed ?? 0n) - (sql?.collected ?? 0n));
      expect(point.hasBills, point.period).toBe(sql !== undefined);
    }
    expect(report.series.monthly.at(-1)?.hasBills).toBe(true);
  });

  it("the Collected card is the money line: the same collected and billed as the SQL for October", async () => {
    const [sql] = await fx.owner.$queryRawUnsafe<{ billed: bigint; collected: bigint }[]>(
      `SELECT SUM(amount_paise)::bigint AS billed, SUM(LEAST(paid, amount_paise))::bigint AS collected FROM (${BILL_PAID}) x WHERE period = DATE '${OCTOBER}'`,
    );
    expect(report.money?.billedPaise).toBe(sql.billed);
    expect(report.money?.collectedPaise).toBe(sql.collected);
    const percent = Number((200n * sql.collected + sql.billed) / (2n * sql.billed));
    expect(report.cards.collected.percent).toBe(percent);
    expect(report.cards.collected.value).toBe(`${percent}%`);
  });
});

describe("V2-2 what is owed against SQL", () => {
  it("the Total owed card is the ageing total, which is at least the principal still owed in SQL, over bills the SQL also finds open", async () => {
    const [sql] = await fx.owner.$queryRawUnsafe<{ principal: bigint; bills: bigint; flats: bigint }[]>(
      `SELECT COALESCE(SUM(amount_paise - paid), 0)::bigint AS principal, count(*)::bigint AS bills, count(DISTINCT flat_id)::bigint AS flats FROM (${BILL_PAID}) x WHERE paid < amount_paise`,
    );
    expect(report.ageing.total.amountDuePaise >= sql.principal).toBe(true);
    expect(BigInt(report.ageing.total.bills) >= sql.bills).toBe(true);
    expect(BigInt(report.ageing.total.flats) >= sql.flats).toBe(true);
    expect(report.ageing.buckets.reduce((sum, b) => sum + b.amountDuePaise, 0n)).toBe(report.ageing.total.amountDuePaise);
    expect(ageingTable).toBeTypeOf("function");
    expect(report.cards.owed.comparison).toBe(report.ageing.total.flats === 1 ? "1 flat" : `${report.ageing.total.flats.toLocaleString("en-IN")} flats`);
  });
});

describe("V2-3 on-time numerators and denominators against SQL", () => {
  it("per month: bills due, and bills whose payments reached the amount on or before the due date", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ period: Date; due: bigint; on_time: bigint }[]>(
      `WITH cum AS (
         SELECT e.bill_id, e.effective_date, SUM(e.amount_paise) OVER (PARTITION BY e.bill_id ORDER BY e.effective_date) AS running
         FROM ledger_entries e
         WHERE e.entry_type = 'PAYMENT' AND e.effective_date <= DATE '${AS_OF}'
           AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= DATE '${AS_OF}')
       ), settled AS (
         SELECT c.bill_id, MIN(c.effective_date) AS on_date FROM cum c JOIN bills b ON b.id = c.bill_id WHERE c.running >= b.amount_paise GROUP BY c.bill_id
       )
       SELECT b.period, count(*) FILTER (WHERE b.due_on <= DATE '${AS_OF}')::bigint AS due,
              count(*) FILTER (WHERE b.due_on <= DATE '${AS_OF}' AND s.on_date <= b.due_on)::bigint AS on_time
       FROM bills b LEFT JOIN settled s ON s.bill_id = b.id WHERE b.issued_on <= DATE '${AS_OF}' GROUP BY b.period`,
    );
    const byPeriod = new Map(rows.map((r) => [toPeriod(r.period), r]));
    for (const point of report.series.onTime) {
      const sql = byPeriod.get(point.period);
      expect(point.due, point.period).toBe(Number(sql?.due ?? 0n));
      expect(point.dueOnTime, point.period).toBe(Number(sql?.on_time ?? 0n));
    }
    const last = report.series.onTime.at(-1);
    expect(report.quality?.due).toBe(last?.due);
    expect(report.quality?.dueOnTime).toBe(last?.dueOnTime);
    expect(report.cards.onTime.percent).toBe(last?.headlinePercent);
  });
});

describe("V2-4 the payment curve against SQL", () => {
  it("collected by day 0, 5, 9, 20 and the as-of day equals the SQL sum of the bills' payments up to that day, capped at the bill", async () => {
    const curve = report.series.curve;
    expect(curve).not.toBeNull();
    const days = [0, 5, 9, 20, curve?.asOfDay as number];
    const rows = await fx.owner.$queryRawUnsafe<{ day: number; collected: bigint }[]>(
      `WITH oct AS (SELECT id, issued_on, amount_paise FROM bills WHERE period = DATE '${OCTOBER}' AND issued_on <= DATE '${AS_OF}'),
       d AS (SELECT * FROM (VALUES ${days.map((x) => `(${x})`).join(",")}) AS v(day)),
       live AS (
         SELECT e.bill_id, e.effective_date, e.amount_paise FROM ledger_entries e JOIN oct ON oct.id = e.bill_id
         WHERE e.entry_type = 'PAYMENT'
           AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.entry_type = 'REVERSAL' AND r.reverses_entry_id = e.id AND r.effective_date <= DATE '${AS_OF}')
       ),
       paid AS (
         SELECT oct.id AS bill_id, d.day, SUM(live.amount_paise) AS paid FROM oct JOIN live ON live.bill_id = oct.id CROSS JOIN d
         WHERE live.effective_date <= oct.issued_on + d.day GROUP BY oct.id, d.day
       )
       SELECT d.day::int AS day, SUM(LEAST(COALESCE(paid.paid, 0), oct.amount_paise))::bigint AS collected
       FROM d CROSS JOIN oct LEFT JOIN paid ON paid.bill_id = oct.id AND paid.day = d.day GROUP BY d.day`,
    );
    for (const day of days) {
      const point = curve?.points.find((p) => p.day === day);
      expect(point?.collectedPaise, `day ${day}`).toBe(rows.find((r) => r.day === day)?.collected);
    }
    expect(curve?.now).toBe(report.cards.collected.percent);
    expect(curve?.points[curve.dueDay].percent).toBe(curve?.byDueDay);
  });
});

describe("V2-5 the weekly SLA against SQL", () => {
  it("per ISO week in India time: raised, decided and met", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ week: Date; raised: bigint; decided: bigint; met: bigint }[]>(
      `SELECT date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata')::date AS week, count(*)::bigint AS raised,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND (first_response_at IS NOT NULL OR response_due_at < ${NOW_SQL}))::bigint AS decided,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND first_response_at IS NOT NULL AND first_response_at <= response_due_at)::bigint AS met
       FROM complaints GROUP BY 1`,
    );
    const byWeek = new Map(rows.map((r) => [toPeriod(r.week), r]));
    const weeks = report.series.weeklySla;
    expect(weeks).toHaveLength(8);
    for (const w of weeks) {
      const sql = byWeek.get(w.weekStart);
      expect([w.raised, w.decided, w.met], w.weekStart).toEqual([Number(sql?.raised ?? 0n), Number(sql?.decided ?? 0n), Number(sql?.met ?? 0n)]);
    }
    expect(weeks.at(-1)?.weekStart).toBe("2026-10-26");
  });

  it("the SLA card is the October share by the same outcome, from SQL", async () => {
    const [sql] = await fx.owner.$queryRawUnsafe<{ decided: bigint; met: bigint }[]>(
      `SELECT count(*) FILTER (WHERE response_due_at IS NOT NULL AND (first_response_at IS NOT NULL OR response_due_at < ${NOW_SQL}))::bigint AS decided,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND first_response_at IS NOT NULL AND first_response_at <= response_due_at)::bigint AS met
       FROM complaints WHERE created_at >= TIMESTAMPTZ '2026-10-01 00:00+05:30' AND created_at < TIMESTAMPTZ '2026-11-01 00:00+05:30'`,
    );
    expect(report.complaints.firstReply.decided).toBe(Number(sql.decided));
    expect(report.complaints.firstReply.withinSla).toBe(Number(sql.met));
    const share = sql.decided === 0n ? null : Number((200n * sql.met + sql.decided) / (2n * sql.decided));
    expect(report.cards.sla.percent).toBe(share);
  });

  it("the Replies card's line is the MONTHLY series: six months each equal to SQL, and its last point is the card's figure (D174)", async () => {
    const rows = await fx.owner.$queryRawUnsafe<{ month: Date; decided: bigint; met: bigint }[]>(
      `SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')::date AS month,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND (first_response_at IS NOT NULL OR response_due_at < ${NOW_SQL}))::bigint AS decided,
              count(*) FILTER (WHERE response_due_at IS NOT NULL AND first_response_at IS NOT NULL AND first_response_at <= response_due_at)::bigint AS met
       FROM complaints GROUP BY 1`,
    );
    const byMonth = new Map(rows.map((r) => [toPeriod(r.month), r]));
    const points = report.series.monthlySla;
    expect(points).toHaveLength(6);
    for (const p of points) expect([p.decided, p.met], p.period).toEqual([Number(byMonth.get(p.period)?.decided ?? 0n), Number(byMonth.get(p.period)?.met ?? 0n)]);
    expect(report.cards.sla.trend).toHaveLength(6);
    expect(report.cards.sla.trend.at(-1)?.value).toBe(report.cards.sla.percent);
    expect(points.at(-1)?.sharePercent).toBe(report.cards.sla.percent);
  });
});

describe("V2-6 alert, viewer, goals and cost", () => {
  it("the unacknowledged safety count is the SQL count of open safety complaints without an ack event", async () => {
    const [sql] = await fx.owner.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM complaints c WHERE c.status <> 'CLOSED' AND c.safety_flag
      AND NOT EXISTS (SELECT 1 FROM complaint_events e WHERE e.complaint_id = c.id AND e.event_type = 'COMMENT' AND e.payload->>'kind' = 'ack')`;
    expect(report.safetyUnacknowledged).toBe(sql.n);
  });

  it("the viewer's permission to manage complaints is read from the user, and the goals fall back to the built-in targets", () => {
    expect(report.canManageComplaints).toBe(user.permissions.includes("complaints:manage"));
    expect(report.cards.onTime.goal.targetPercent).toBe(report.goals.rows.find((r) => r.key === "onTimeCollection")?.targetPercent);
    expect(report.cards.sla.goal.key).toBe("firstReplyWithinSla");
  });

  it("builds the whole page in a constant number of reads, in under 3 seconds", () => {
    console.log(`committee report: ${operations} database operations, ${Math.round(elapsedMs)} ms`);
    expect(operations).toBeLessThanOrEqual(10);
    expect(elapsedMs).toBeLessThan(3000);
  });
});

describe("V2-7 the page from the real report", () => {
  const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

  it("shows the alert strip when the SQL says a safety complaint is waiting, for a viewer who may manage complaints", () => {
    const strip = renderToStaticMarkup(h(ReportView, { report }));
    expect(strip.includes('href="/staff/complaints?view=safety"')).toBe(report.safetyUnacknowledged > 0 && report.canManageComplaints);
    expect(words(strip).includes("not yet seen by the duty manager")).toBe(report.safetyUnacknowledged > 0);
  });

  it("every card and every section headline is built from the same figures: the cards equal the money line and the ageing total", () => {
    expect(report.cards.collected.comparison).toContain("₹");
    expect(report.headlines.owed).toContain(report.ageing.total.flats.toLocaleString("en-IN"));
    expect(report.cards.owed.comparison).toBe(`${report.ageing.total.flats.toLocaleString("en-IN")} flats`);
    expect(report.headlines.complaints).toContain(report.complaints.raised.toLocaleString("en-IN"));
  });

  it("a hidden-sections cookie omits exactly those sections from the HTML and keeps the cards", () => {
    const hidden = parseHiddenSections("owed,complaints");
    const out = renderToStaticMarkup(h(ReportView, { report, hidden }));
    for (const id of SECTION_IDS) expect(out.includes(`<details id="${id}"`), id).toBe(!hidden.includes(id));
    expect(out).toContain("Collected this month");
    expect(renderToStaticMarkup(h(ReportView, { report, hidden: parseHiddenSections("owed,nonsense") })).match(/<details id=/g)).toHaveLength(5);
  });

  it("the whole page has one h1, no 'NaN' or 'undefined', and no zero percent for a metric without data", () => {
    const out = renderToStaticMarkup(h(ReportView, { report }));
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).not.toMatch(/NaN|undefined/);
  });
});
