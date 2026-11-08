import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AboutBlock } from "@/app/(staff)/staff/reports/about-block";
import { ComplaintsBlock } from "@/app/(staff)/staff/reports/complaints-block";
import { QualityBlock } from "@/app/(staff)/staff/reports/quality-block";
import { ReconciliationBlock } from "@/app/(staff)/staff/reports/reconciliation-block";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { type ReportComplaint, complaintMetrics } from "@/domain/reports/complaints";
import { defaultGoals, evaluateGoals } from "@/domain/reports/goals";
import type { CollectionQuality } from "@/domain/reports/money-line";
import { paymentCurve } from "@/domain/reports/payment-curve";
import { reconciliationLine } from "@/domain/reports/reconciliation";
import { NOW, emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const minute = 60_000;
const T0 = Date.UTC(2026, 9, 5, 6, 30);
const goal = emptyReport().cards.onTime.goal;
const NO_ZERO = /(^|[^0-9])0%/;
const metGoal = { ...goal, status: "MET" as const };

describe("CB1 collection quality: three rows, three plain numbers, no 'paid late'", () => {
  const quality: CollectionQuality = { due: 2399, dueOnTime: 1687, paidOnTime: 1687, paid: 1915, paidLate: 228, medianDaysToPay: 3 };
  const curve = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" });
  const out = html(h(QualityBlock, { quality, curve, goal }));
  const text = words(out);

  it("shows the headline on-time rate with its goal, the secondary rate and the median days, each with what it counts", () => {
    expect(text).toContain("Paid on time 1687 of 2399 bills due so far were paid on or before their due date Goal: At least 90%");
    expect(text).toContain("70%");
    expect(text).toContain("On time, of paid bills 1687 of 1915 paid bills were paid on or before their due date 88%");
    expect(text).toContain("Median days to pay From the day the bill was issued, over 1915 paid bills 3 days");
  });

  it("has exactly three rows and no 'Paid late' row", () => {
    expect(count(out, /<dd class="tnum text-right/g)).toBe(3);
    expect(text).not.toContain("Paid late");
  });

  it("says Met or Not met with the goal, in words and an icon", () => {
    expect(words(html(h(QualityBlock, { quality, curve, goal: metGoal })))).toContain("Met");
    const notMet = html(h(QualityBlock, { quality, curve, goal: { ...goal, status: "NOT_MET" as const } }));
    expect(words(notMet)).toContain("Not met");
    expect(notMet).toContain("<svg");
  });

  it("gives the three plain numbers, and the curve only from 768px", () => {
    expect(text).toContain("Paid by the due date 70%, by day 20 70%, now 70%.");
    expect(out).toContain('<div class="hidden md:block"><figure');
    expect(out).toContain('aria-labelledby="curve-title curve-desc"');
  });

  it("before day 20 the second number is left out", () => {
    const early = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-12" });
    expect(words(html(h(QualityBlock, { quality, curve: early, goal })))).toContain("Paid by the due date 0%, now 0%.");
  });

  it("says 'No data' in words, never 0%, when there is nothing to measure", () => {
    const none = words(html(h(QualityBlock, { quality: { due: 0, dueOnTime: 0, paidOnTime: 0, paid: 0, paidLate: 0, medianDaysToPay: null }, curve: null, goal: { ...goal, status: "NO_DATA" } })));
    expect(none).toContain("Paid on time Goal: At least 90% No data");
    expect(none).toContain("On time, of paid bills No data");
    expect(none).toContain("Median days to pay No data");
    expect(none).not.toMatch(NO_ZERO);
  });

  it("one day is '1 day'", () => {
    expect(words(html(h(QualityBlock, { quality: { ...quality, medianDaysToPay: 1 }, curve: null, goal })))).toContain("over 1915 paid bills 1 day");
  });
});

describe("CB2 complaints: six lines and one safety line", () => {
  const c = (over: Partial<ReportComplaint> = {}): ReportComplaint => ({ createdAt: T0, safetyFlag: false, status: "ASSIGNED", closeKind: null, responseDueAt: T0 + 1440 * minute, firstResponseAt: null, reopenCount: 0, resolvedAt: null, acknowledgedAt: null, closedAt: null, ...over });
  const rows = [
    c({ firstResponseAt: T0 + 30 * minute, resolvedAt: T0 + 120 * minute, status: "CLOSED", closeKind: "CONFIRMED" }),
    c({ firstResponseAt: T0 + 90 * minute, resolvedAt: T0 + 600 * minute, reopenCount: 1, status: "CLOSED", closeKind: "AUTO_CLOSED" }),
    c({ firstResponseAt: T0 + 2000 * minute }),
    c({ safetyFlag: true, firstResponseAt: T0 + 5 * minute, acknowledgedAt: T0 + 5 * minute }),
    c({ safetyFlag: true }),
  ];
  const metrics = complaintMetrics(rows, NOW);
  const goals = evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: metrics.firstReply.withinSla, d: metrics.firstReply.decided }, reopened: { n: metrics.resolved.reopened, d: metrics.resolved.count } });
  const props = { complaints: metrics, goals: goals.map((g) => g), slaGoal: goal, weeks: emptyReport().series.weeklySla, period: "2026-10-01", asOf: "2026-10-27", unseenAllMonths: 1 };
  const out = html(h(ComplaintsBlock, props));
  const text = words(out);

  it("has six lines: raised, first reply with the SLA goal, time to resolved, reopened with its goal, closed by whom, open now", () => {
    expect(count(out, /<dd class="tnum text-right/g)).toBe(6);
    expect(text).toContain("Raised 5");
    expect(text).toContain("First reply 3 of 5 complaints whose reply was due Goal: At least 90%");
    expect(text).toContain("30 min, 60% in time");
    expect(text).toContain("Time to marked resolved, median From raising to the first time it was marked resolved, over 2 complaints 2 h");
    expect(text).toContain("Reopened 1 of 2 complaints that were marked resolved Goal: At most 8% Not met");
    expect(text).toContain("1 by the resident, 1 automatically after no reply, 0 by the duty manager");
    expect(text).toContain("Raised 5 = closed 2 + still open 3");
    expect(text).toContain("Open now 3");
  });

  it("the safety lines: the month's groups, the all-months count of open ones not yet seen in alert styling, and the median only when there is one (D171)", () => {
    expect(text).toContain("Safety complaints raised in October: 2. Closed by the duty manager: 0. Open and seen: 1. Open and not yet seen: 1.");
    expect(text).toContain("Open and not yet seen, all months: 1");
    expect(text).toContain("Typical time until the duty manager saw it: 5 min (the middle value).");
    expect(out).toContain("border-caution");
  });

  it("a complaint closed by the duty manager is seen; nothing unseen has no alert styling; a month without safety complaints says so", () => {
    const closed = c({ safetyFlag: true, status: "CLOSED", closeKind: "DUTY_MANAGER", closedAt: T0 + 20 * minute });
    const all = html(h(ComplaintsBlock, { ...props, unseenAllMonths: 0, complaints: complaintMetrics([closed], NOW) }));
    expect(words(all)).toContain("Closed by the duty manager: 1. Open and seen: 0. Open and not yet seen: 0.");
    expect(words(all)).toContain("Typical time until the duty manager saw it: 20 min");
    expect(all).not.toContain("border-caution");
    expect(words(html(h(ComplaintsBlock, { ...props, complaints: complaintMetrics([c()], NOW) })))).toContain("No safety complaints were raised.");
  });

  it("the weekly chart is drawn from 768px only, with its own table, and only when some week has a share to draw", () => {
    const week = (weekStart: string, share: number | null) => ({ weekStart, raised: 3, decided: share === null ? 0 : 3, met: share === null ? 0 : 2, sharePercent: share, partial: false });
    const drawn = html(h(ComplaintsBlock, { ...props, weeks: [week("2026-10-12", 67), week("2026-10-19", null)] }));
    expect(drawn).toContain('<div class="hidden md:block"><figure');
    expect(drawn).toContain('aria-labelledby="weekly-title weekly-desc"');
    expect(out).not.toContain("weekly-title");
  });

  it("a month with no complaints says so once, shows no zero percent and no safety line", () => {
    const none = words(html(h(ComplaintsBlock, { ...props, complaints: complaintMetrics([], NOW) })));
    expect(none).toContain("No complaints were raised in this month.");
    expect(none).not.toMatch(NO_ZERO);
    expect(none).not.toContain("safety");
  });

  it("zero denominators say 'No data': nothing replied, nothing resolved", () => {
    const noGoals = evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } });
    const text2 = words(html(h(ComplaintsBlock, { ...props, goals: noGoals, complaints: complaintMetrics([c({ responseDueAt: NOW + 60 * minute })], NOW) })));
    expect(text2).toContain("No data, No data in time");
    expect(text2).toContain("Time to marked resolved, median No data");
    expect(text2).toContain("Reopened Goal: At most 8% No data");
  });
});

describe("CB3 the bank reconciliation: three lines, then the check, then the table only when needed", () => {
  const states = { QUEUED: 42, AUTO_MATCHED: 25, AWAITING_APPROVAL: 1, MANUALLY_MATCHED: 3, IGNORED: 35 };
  const imports = [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }];
  const withDecisions = reconciliationLine({
    states,
    imports,
    decisions: [
      { decision: "MANUAL", importedAt: T0, decidedAt: T0 + 20 * minute },
      { decision: "MANUAL", importedAt: T0, decidedAt: T0 + 40 * minute },
      { decision: "APPROVED", importedAt: T0, decidedAt: T0 + 90 * minute },
    ],
  });
  const none = reconciliationLine({ states, imports, decisions: [] });
  const out = html(h(ReconciliationBlock, { line: withDecisions }));
  const text = words(out);

  it("shows three lines: posted automatically with the share, waiting, not maintenance", () => {
    expect(text).toContain("25 of 106 bank rows posted automatically (24%)");
    expect(text).toContain("42 waiting for a person, 1 waiting for approval");
    expect(text).toContain("35 not maintenance");
    expect(count(out, /<li>/g)).toBe(3);
  });

  it("says in words, with a check, that the import's rows add up", () => {
    expect(text).toContain("The rows of the 1 import all add up.");
    expect(out).not.toContain('role="alert"');
  });

  it("an import that does not add up is an alert with an icon and words, and no check", () => {
    const bad = html(h(ReconciliationBlock, { line: reconciliationLine({ states, imports: [{ rowsRead: 106, stored: 100, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) }));
    expect(bad).toContain('role="alert"');
    expect(words(bad)).toContain("1 of 1 imports do not add up. Do not post from them until they are checked.");
  });

  it("the manual interventions table is shown when at least one count is above zero, by decision type, with the median time", () => {
    expect(text).toContain("Manual interventions in the last 30 days, by decision type");
    expect(text).toContain("Manual match 2 20 min");
    expect(text).toContain("Approved 1 1 h 30 min");
    expect(text).toContain("Rejected 0 No data");
    expect(out).toContain('<th scope="col"');
  });

  it("with every count at zero there is no table and the section says there were no manual decisions", () => {
    const quiet = html(h(ReconciliationBlock, { line: none }));
    expect(quiet).not.toContain("<table");
    expect(words(quiet)).toContain("No manual decisions in this period.");
  });

  it("no import in the window says so in words, and an import without rows does not divide by zero", () => {
    expect(words(html(h(ReconciliationBlock, { line: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }) })))).toContain("No bank statement was imported in the last 30 days.");
    const empty = words(html(h(ReconciliationBlock, { line: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [{ rowsRead: 0, stored: 0, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) })));
    expect(empty).toContain("The imports in this period held no bank rows.");
    expect(empty).not.toMatch(/NaN|(^|[^0-9])0%/);
  });

  it("names no flat and no person", () => {
    expect(out).not.toMatch(/T\d\d-\d{4}|\b\d{10}\b/);
  });
});

describe("CB4 about these numbers", () => {
  it("gives the as-of date, a sentence for every metric, and the goals note only when the setting is not set", () => {
    const set = words(html(h(AboutBlock, { asOf: "2026-10-27", goalsAreDefaults: false })));
    expect(set).toContain("About these numbers");
    expect(set).toContain("All figures are as of 27 October 2026.");
    expect(set).toContain("out of ALL the month's bills that are due so far");
    expect(set).toContain("A late first reply counts as missed");
    expect(set).not.toContain("committee_goals");
    expect(words(html(h(AboutBlock, { asOf: "2026-10-27", goalsAreDefaults: true })))).toContain("The committee_goals setting is not set, so the built-in targets are shown.");
  });
});

describe("CB5 the whole page", () => {
  const out = html(h(ReportView, { report: emptyReport() }));

  it("with an empty month and no complaints or imports it says so in each section and has no zero percent and no 'NaN'", () => {
    expect(words(out)).toContain("No bills for this month");
    expect(words(out)).toContain("No complaints were raised in this month.");
    expect(words(out)).toContain("No bank statement was imported in the last 30 days.");
    expect(out).not.toMatch(/NaN|undefined|null/);
    expect(words(out)).not.toMatch(NO_ZERO);
  });

  it("has the five sections in order as <details> with the ids money, owed, quality, complaints, bank, and no Goals section", () => {
    const order = ["money", "owed", "quality", "complaints", "bank"].map((id) => out.indexOf(`<details id="${id}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(count(out, /<details id=/g)).toBe(5);
    expect(out).not.toMatch(/<h2[^>]*>Goals<\/h2>/);
    expect(words(out)).not.toContain("Goals against");
  });

  it("each summary shows the title and a one-sentence headline", () => {
    for (const id of ["money", "owed", "quality", "complaints", "bank"]) {
      const summary = new RegExp(`<details id="${id}"[\\s\\S]*?</summary>`).exec(out)?.[0] ?? "";
      expect(summary, id).toMatch(/<h2[^>]*>[^<]+<\/h2><span class="text-body text-ink-2">[^<]+<\/span>/);
    }
  });

  it("uses no uppercase, no letter-spacing and no filled control", () => {
    expect(out).not.toMatch(/uppercase|tracking-/);
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});

describe("CB6 the responsive defaults", () => {
  const sections = () => [{ open: false }, { open: false }];

  it("from 768px it opens the sections the server marked, and below it opens nothing", async () => {
    const { applyResponsiveDefaults } = await import("@/app/(staff)/staff/reports/responsive-defaults");
    const wide = sections();
    expect(applyResponsiveDefaults({ matchMedia: () => ({ matches: true }), sections: () => wide })).toBe(2);
    expect(wide.map((s) => s.open)).toEqual([true, true]);
    const narrow = sections();
    expect(applyResponsiveDefaults({ matchMedia: () => ({ matches: false }), sections: () => narrow })).toBe(0);
    expect(narrow.map((s) => s.open)).toEqual([false, false]);
  });

  it("asks about 768px and leaves a section that is already open alone", async () => {
    const { applyResponsiveDefaults } = await import("@/app/(staff)/staff/reports/responsive-defaults");
    const queries: string[] = [];
    const mixed = [{ open: true }, { open: false }];
    expect(applyResponsiveDefaults({ matchMedia: (q) => (queries.push(q), { matches: true }), sections: () => mixed })).toBe(1);
    expect(queries).toEqual(["(min-width: 768px)"]);
  });

  it("the server marks only the first two sections, closed, and marks none when it opened one for a drill-down", () => {
    const base = html(h(ReportView, { report: emptyReport() }));
    expect(count(base, /data-default-open="true"/g)).toBe(2);
    expect(base).toMatch(/<details id="money"[^>]*data-default-open="true"/);
    expect(base).toMatch(/<details id="owed"[^>]*data-default-open="true"/);
    expect(base).not.toMatch(/<details[^>]* open=""/);
  });

  it("all the content of a closed section is in the HTML", () => {
    expect(words(html(h(ReportView, { report: emptyReport() })))).toContain("No bank statement was imported in the last 30 days.");
  });
});
