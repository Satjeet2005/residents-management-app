import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComplaintsBlock } from "@/app/(staff)/staff/reports/complaints-block";
import { GoalsBlock } from "@/app/(staff)/staff/reports/goals-block";
import { QualityBlock } from "@/app/(staff)/staff/reports/quality-block";
import { ReconciliationBlock } from "@/app/(staff)/staff/reports/reconciliation-block";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { type ReportComplaint, complaintMetrics } from "@/domain/reports/complaints";
import { defaultGoals, evaluateGoals } from "@/domain/reports/goals";
import type { CollectionQuality } from "@/domain/reports/money-line";
import { reconciliationLine } from "@/domain/reports/reconciliation";
import { NOW, emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const minute = 60_000;
const T0 = Date.UTC(2026, 9, 5, 6, 30);

describe("CB1 collection quality", () => {
  const quality: CollectionQuality = { dueOrPaid: 2399, paidOnTime: 1687, paid: 1915, paidLate: 228, medianDaysToPay: 3 };
  const out = html(h(QualityBlock, { period: "2026-10-01", quality }));
  const text = words(out);

  it("shows the on-time rate, the median days to pay and the share paid late, each with what it counts", () => {
    expect(text).toContain("Collection quality, October 2026");
    expect(text).toContain("Paid on time 1687 of 2399 bills settled on or before their due date 70%");
    expect(text).toContain("Median days to pay From the day the bill was issued, over 1915 paid bills 3 days");
    expect(text).toContain("Paid late 228 of 1915 paid bills settled after their due date 12%");
  });

  it("is a description list with tabular, right-aligned figures", () => {
    expect(out).toContain("<dl");
    expect(count(out, /<dd class="tnum text-right/g)).toBe(3);
  });

  it("says 'No data' in words, never 0%, when there is nothing to measure", () => {
    const none = words(html(h(QualityBlock, { period: "2026-10-01", quality: { dueOrPaid: 0, paidOnTime: 0, paid: 0, paidLate: 0, medianDaysToPay: null } })));
    expect(none).toContain("Paid on time No data");
    expect(none).toContain("Median days to pay No data");
    expect(none).toContain("Paid late No data");
    expect(none).not.toContain("0%");
  });

  it("one day is '1 day'", () => {
    expect(words(html(h(QualityBlock, { period: "2026-10-01", quality: { ...quality, medianDaysToPay: 1 } })))).toContain("Median days to pay From the day the bill was issued, over 1915 paid bills 1 day");
  });
});

describe("CB2 complaints", () => {
  const c = (over: Partial<ReportComplaint> = {}): ReportComplaint => ({ createdAt: T0, safetyFlag: false, status: "ASSIGNED", closeKind: null, responseDueAt: T0 + 1440 * minute, firstResponseAt: null, reopenCount: 0, resolvedAt: null, acknowledgedAt: null, ...over });
  const rows = [
    c({ firstResponseAt: T0 + 30 * minute, resolvedAt: T0 + 120 * minute, status: "CLOSED", closeKind: "CONFIRMED" }),
    c({ firstResponseAt: T0 + 90 * minute, resolvedAt: T0 + 600 * minute, reopenCount: 1, status: "CLOSED", closeKind: "AUTO_CLOSED" }),
    c({ firstResponseAt: T0 + 2000 * minute }),
    c({ safetyFlag: true, firstResponseAt: T0 + 5 * minute, acknowledgedAt: T0 + 5 * minute }),
    c({ safetyFlag: true }),
  ];
  const metrics = complaintMetrics(rows, NOW);
  const out = html(h(ComplaintsBlock, { period: "2026-10-01", complaints: metrics }));
  const text = words(out);

  it("shows how many were raised, the first reply median and the SLA share with their counts", () => {
    expect(text).toContain("Complaints, October 2026");
    expect(text).toContain("Raised 5");
    expect(text).toContain("First reply, median From raising to the first reply, over 4 replied complaints 30 min");
    expect(text).toContain("Replied within the SLA 3 of 5 complaints whose reply was due 60%");
  });

  it("shows the time to marked resolved, the reopened share of the resolved, who closed them and how many are open now", () => {
    expect(text).toContain("Time to marked resolved, median From raising to the first time it was marked resolved, over 2 complaints 2 h");
    expect(text).toContain("Reopened 1 of 2 complaints that were marked resolved 50%");
    expect(text).toContain("Closed by the resident 1");
    expect(text).toContain("Closed by itself After no answer from the resident 1");
    expect(text).toContain("Open now 3");
  });

  it("shows the safety figures and warns, with an icon and words, that one is waiting for the duty manager", () => {
    expect(text).toContain("Safety complaints");
    expect(text).toContain("Raised 2");
    expect(text).toContain("Time to acknowledgement, median From raising to the duty manager's acknowledgement, over 1 acknowledged 5 min");
    expect(text).toContain("Not yet acknowledged 1");
    expect(out).toMatch(/<p role="status"[^>]*border-caution[^>]*><svg[\s\S]*?<\/svg>1 safety complaint is waiting for the duty manager\.<\/p>/);
  });

  it("several waiting are said in the plural, and none draws no warning", () => {
    const two = complaintMetrics([c({ safetyFlag: true }), c({ safetyFlag: true })], NOW);
    expect(words(html(h(ComplaintsBlock, { period: "2026-10-01", complaints: two })))).toContain("2 safety complaints are waiting for the duty manager.");
    const acked = complaintMetrics([c({ safetyFlag: true, acknowledgedAt: T0 + minute })], NOW);
    expect(html(h(ComplaintsBlock, { period: "2026-10-01", complaints: acked }))).not.toContain("waiting for the duty manager");
  });

  it("a month with no complaints says so once, and shows no zero percent", () => {
    const none = html(h(ComplaintsBlock, { period: "2026-10-01", complaints: complaintMetrics([], NOW) }));
    expect(words(none)).toContain("No complaints were raised in this month.");
    expect(none).not.toContain("<dl");
    expect(none).not.toContain("0%");
  });

  it("zero denominators say 'No data': no replies, nothing resolved, no safety acknowledgement", () => {
    const lone = words(html(h(ComplaintsBlock, { period: "2026-10-01", complaints: complaintMetrics([c({ responseDueAt: NOW + minute })], NOW) })));
    expect(lone).toContain("First reply, median No data");
    expect(lone).toContain("Replied within the SLA No data");
    expect(lone).toContain("Time to marked resolved, median No data");
    expect(lone).toContain("Reopened No data");
    expect(lone).toContain("Time to acknowledgement, median No data");
    expect(lone).not.toContain("0%");
  });
});

describe("CB3 the reconciliation line", () => {
  const states = { QUEUED: 42, AUTO_MATCHED: 25, AWAITING_APPROVAL: 1, MANUALLY_MATCHED: 3, IGNORED: 35 };
  const line = reconciliationLine({
    states,
    imports: [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }],
    decisions: [
      { decision: "MANUAL", importedAt: T0, decidedAt: T0 + 20 * minute },
      { decision: "MANUAL", importedAt: T0, decidedAt: T0 + 40 * minute },
      { decision: "APPROVED", importedAt: T0, decidedAt: T0 + 90 * minute },
    ],
  });
  const out = html(h(ReconciliationBlock, { line }));
  const text = words(out);

  it("shows the rows by what became of them, and the share posted automatically with its counts", () => {
    expect(text).toContain("Bank reconciliation, last 30 days");
    for (const part of ["Bank rows imported 106", "Posted automatically 25", "Posted by hand 3", "Waiting for a person 42", "Waiting for approval 1", "Not maintenance 35"]) expect(text).toContain(part);
    expect(text).toContain("Share posted automatically 25 of 106 bank rows 24%");
  });

  it("says in words, with a check, that the import's rows add up", () => {
    expect(out).toMatch(/<p class="flex items-center gap-2 text-body font-semibold"><svg[\s\S]*?<\/svg>The rows of the 1 import all add up\.<\/p>/);
    expect(words(html(h(ReconciliationBlock, { line: reconciliationLine({ states, imports: [{ rowsRead: 5, stored: 5, invalidRows: 0, alreadyImported: 0 }, { rowsRead: 5, stored: 5, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) })))).toContain("The rows of all 2 imports add up.");
  });

  it("an import that does not add up is an alert with an icon and words, and no check", () => {
    const bad = html(h(ReconciliationBlock, { line: reconciliationLine({ states, imports: [{ rowsRead: 5, stored: 4, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) }));
    expect(bad).toMatch(/<p role="alert"[^>]*border-caution[^>]*><svg/);
    expect(words(bad)).toContain("1 of 1 imports do not add up. Do not post from them until they are checked.");
    expect(words(bad)).not.toContain("The rows of");
  });

  it("the manual interventions are a captioned table by decision type, with counts and the median time from import to decision", () => {
    expect(out).toContain('<caption class="sr-only">Manual interventions in the last 30 days, by decision type</caption>');
    expect(count(out, /<th scope="col"/g)).toBe(3);
    expect(count(out, /<th scope="row"/g)).toBe(4);
    const body = words(out.slice(out.indexOf("<tbody>")));
    expect(body).toContain("Manual match 2 20 min");
    expect(body).toContain("Approved 1 1 h 30 min");
    expect(body).toContain("Rejected 0 No data");
    expect(body).toContain("Ignored 0 No data");
    expect(out).toMatch(/<td class="tnum py-2 pr-4 text-right">2<\/td>/);
  });

  it("no import in the window says so in words", () => {
    const none = html(h(ReconciliationBlock, { line: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }) }));
    expect(words(none)).toContain("No bank statement was imported in the last 30 days.");
    expect(none).not.toContain("<table");
  });

  it("names no flat and no person", () => {
    expect(text).not.toMatch(/T\d\d-\d{4}/);
    expect(text).not.toMatch(/\d{10}/);
  });
});

describe("CB4 the goals", () => {
  const rows = evaluateGoals(defaultGoals, { onTime: { n: 70, d: 100 }, firstReply: { n: 95, d: 100 }, reopened: { n: 10, d: 100 } });
  const out = html(h(GoalsBlock, { goals: { rows, source: "SETTING" } }));
  const body = words(out.slice(out.indexOf("<tbody>")));

  it("is a captioned table with a target, the actual and the result of each goal", () => {
    expect(out).toContain('<caption class="sr-only">Goals against this month&#x27;s figures</caption>');
    expect(count(out, /<th scope="col"/g)).toBe(4);
    expect(count(out, /<th scope="row"/g)).toBe(3);
    expect(body).toContain("Bills paid on time At least 90% 70% Not met");
    expect(body).toContain("First replies within the SLA At least 90% 95% Met");
    expect(body).toContain("Resolved complaints reopened At most 8% 10% Not met");
  });

  it("shows Met and Not met in WORDS with an icon each, never colour alone", () => {
    expect(count(out, />Met<\/span>/g)).toBe(1);
    expect(count(out, />Not met<\/span>/g)).toBe(2);
    expect(count(out, /<svg/g)).toBe(3);
    for (const result of out.match(/<span class="inline-flex[^>]*>[\s\S]*?<\/span>/g) ?? []) expect(result).toContain("<svg");
  });

  it("says No data in words, with no icon, when a goal has nothing to measure", () => {
    const none = html(h(GoalsBlock, { goals: { rows: evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } }), source: "SETTING" } }));
    expect(words(none.slice(none.indexOf("<tbody>")))).toContain("Bills paid on time At least 90% No data No data");
    expect(none).not.toContain("<svg");
    expect(none).not.toContain("Met");
  });

  it("calls the targets assumptions, and says when they are the built-in defaults", () => {
    expect(words(out)).toContain("The targets are assumptions set by the committee in the committee_goals setting.");
    const fallback = words(html(h(GoalsBlock, { goals: { rows, source: "DEFAULT" } })));
    expect(fallback).toContain("The committee_goals setting is not set, so the built-in targets are shown.");
    expect(fallback).not.toContain("assumptions set by the committee");
  });
});

describe("CB5 the whole page", () => {
  const out = html(h(ReportView, { report: emptyReport({ ageing: { buckets: [], total: { flats: 0, bills: 0, amountDuePaise: 0n } } }) }));

  it("with an empty month and no complaints or imports it says so in each block and has no zero percent and no 'NaN'", () => {
    expect(words(out)).toContain("No bills for this month");
    expect(words(out)).toContain("No complaints were raised in this month.");
    expect(words(out)).toContain("No bank statement was imported in the last 30 days.");
    expect(out).not.toMatch(/NaN|undefined|null|\b0%/);
  });

  it("has the blocks in the order of the task inside a grid that is two columns from 1024px", () => {
    const order = ["committee-empty", "committee-ageing", "committee-complaints", "committee-recon", "committee-goals"].map((id) => out.indexOf(`id="${id}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("lg:grid-cols-2");
  });

  it("uses no uppercase, no letter-spacing and no filled control", () => {
    expect(out).not.toMatch(/uppercase|tracking-/);
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});
