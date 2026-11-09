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
const qp = { period: "2026-10-01" };
const metGoal = { ...goal, status: "MET" as const };

describe("CB1 collection quality: three rows, three plain numbers, no 'paid late'", () => {
  const quality: CollectionQuality = { bills: 2399, due: 2399, dueOnTime: 1687, paidOnTime: 1687, paid: 1915, paidLate: 228, medianDaysToPay: 3 };
  const curve = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" });
  const out = html(h(QualityBlock, { ...qp, quality, curve, goal }));
  const text = words(out);

  it("shows the headline on-time rate with its goal, the secondary rate and the median days, each with what it counts", () => {
    expect(text).toContain("Paid by the due date 1,687 of 2,399 bills due so far were paid on or before their due date Goal 90%");
    expect(text).toContain("70%");
    expect(text).toContain("Of bills that were paid, paid on time 1,687 of 1,915 paid bills were paid on or before their due date. This ignores the 484 unpaid bills. 88%");
    expect(text).toContain("Typical days to pay (the middle value) Counted from the day the bill was issued, over 1,915 paid bills 3 days");
  });

  it("has exactly three rows and no 'Paid late' row", () => {
    expect(count(out, /<dd class="tnum text-right/g)).toBe(3);
    expect(text).not.toContain("Paid late");
  });

  it("says Met or Not met with the goal, in words and an icon", () => {
    expect(words(html(h(QualityBlock, { ...qp, quality, curve, goal: metGoal })))).toContain("Met");
    const notMet = html(h(QualityBlock, { ...qp, quality, curve, goal: { ...goal, status: "NOT_MET" as const } }));
    expect(words(notMet)).toContain("Not met");
    expect(notMet).toContain("<svg");
  });

  it("gives the three plain numbers, and the curve only from 768px", () => {
    expect(text).toContain("Share of October's money collected: by the due date 70%, by day 20 70%, today 70% (by rupees, so it differs slightly from the bills figure).");
    expect(out).toContain('<div class="hidden md:block"><figure');
    expect(out).toContain('aria-labelledby="curve-title curve-desc"');
  });

  it("before day 20 the second number is left out", () => {
    const early = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-12" });
    expect(words(html(h(QualityBlock, { ...qp, quality, curve: early, goal })))).toContain("Share of October's money collected: by the due date 0%, today 0% (by rupees, so it differs slightly from the bills figure).");
  });

  it("says 'No data' in words, never 0%, when there is nothing to measure", () => {
    const none = words(html(h(QualityBlock, { ...qp, quality: { bills: 0, due: 0, dueOnTime: 0, paidOnTime: 0, paid: 0, paidLate: 0, medianDaysToPay: null }, curve: null, goal: { ...goal, status: "NO_DATA" } })));
    expect(none).toContain("Paid by the due date Goal 90% No data");
    expect(none).toContain("Of bills that were paid, paid on time No data");
    expect(none).toContain("Typical days to pay (the middle value) No data");
    expect(none).not.toMatch(NO_ZERO);
  });

  it("one day is '1 day'", () => {
    expect(words(html(h(QualityBlock, { ...qp, quality: { ...quality, medianDaysToPay: 1 }, curve: null, goal })))).toContain("over 1,915 paid bills 1 day");
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
  const props = { complaints: metrics, goals: goals.map((g) => g), slaGoal: goal, weeks: emptyReport().series.weeklySla, period: "2026-10-01", asOf: "2026-10-27", unseenAllMonths: 1, slaMinutes: { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 } };
  const out = html(h(ComplaintsBlock, props));
  const text = words(out);

  it("states the promise, then seven lines: raised, typical first reply, replied in time with the goal, time to resolved, reopened with its goal, closed by whom, open now", () => {
    expect(text).toContain("Replies within our promised time Promise: Critical 15 min, High 2 h, Normal 24 h, Low 72 h");
    expect(count(out, /<dd class="tnum text-right/g)).toBe(7);
    expect(text).toContain("Raised 5");
    expect(text).toContain("Typical first reply The middle value, over 4 complaints that were replied to 30 min");
    expect(text).toContain("Replied in time 3 of 5 complaints whose reply was due Goal 90% 60%");
    expect(text).toContain("Typical time until marked resolved (the middle value) From raising to the first time it was marked resolved, over 2 complaints 2 h");
    expect(text).toContain("Reopened after being marked resolved 1 of 2 complaints that were marked resolved Limit 8% · 42 points over Not met");
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
    expect(text2).toContain("Typical first reply No data");
    expect(text2).toContain("Replied in time Goal 90% No data");
    expect(text2).toContain("Typical time until marked resolved (the middle value) No data");
    expect(text2).toContain("Reopened after being marked resolved Limit 8% No data");
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

  it("has ONE summary sentence that accounts for every bank entry, then the by-hand line", () => {
    expect(text).toContain("106 bank entries: 25 matched automatically, 3 matched by hand, 42 waiting for a person, 1 waiting for approval, 35 not maintenance payments.");
    expect(text).toContain("Matched by hand (last 30 days): 3");
    expect(count(out, /<li>/g)).toBe(0);
  });

  it("the parts of the summary add up to the entries (25 + 3 + 42 + 1 + 35 = 106)", () => {
    expect(25 + 3 + 42 + 1 + 35).toBe(106);
  });

  it("says in words, with a check, that every entry is accounted for, and only when the imports add up", () => {
    expect(text).toContain("All 106 accounted for");
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

  it("with every count at zero there is no table, the by-hand line says 0, and the parts for hand and approval are left out", () => {
    expect(html(h(ReconciliationBlock, { line: none }))).not.toContain("<table");
    const plain = reconciliationLine({ states: { QUEUED: 44, AUTO_MATCHED: 24, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 38 }, imports: [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
    const quiet = words(html(h(ReconciliationBlock, { line: plain })));
    expect(quiet).toContain("Matched by hand (last 30 days): 0");
    expect(quiet).toContain("106 bank entries: 24 matched automatically, 44 waiting for a person, 38 not maintenance payments.");
    expect(quiet).toContain("All 106 accounted for");
    expect(quiet).not.toContain("waiting for approval");
  });

  it("the tick is not shown when an import does not add up, and 1,000 entries are grouped", () => {
    const bad = words(html(h(ReconciliationBlock, { line: reconciliationLine({ states: { ...states, QUEUED: 1000 }, imports: [{ rowsRead: 5, stored: 4, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) })));
    expect(bad).not.toContain("accounted for");
    expect(bad).toContain("1,000 waiting for a person");
  });

  it("no import in the window says so in words, and an import without rows does not divide by zero", () => {
    expect(words(html(h(ReconciliationBlock, { line: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [], decisions: [] }) })))).toContain("No bank statement was imported in the last 30 days.");
    const empty = words(html(h(ReconciliationBlock, { line: reconciliationLine({ states: { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 }, imports: [{ rowsRead: 0, stored: 0, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) })));
    expect(empty).toContain("The imports in this period held no bank entries.");
    expect(empty).not.toMatch(/NaN|(^|[^0-9])0%/);
    expect(empty).not.toContain("accounted for");
  });

  it("names no flat and no person", () => {
    expect(out).not.toMatch(/T\d\d-\d{4}|\b\d{10}\b/);
  });
});

describe("CB4 about these numbers", () => {
  it("gives the as-of date and a sentence for every metric, in the new words, with no developer wording", () => {
    const set = words(html(h(AboutBlock, { asOf: "2026-10-27" })));
    expect(set).toContain("About these numbers");
    expect(set).toContain("All figures are as of 27 October 2026.");
    expect(set).toContain("out of ALL the month's bills that are due so far");
    expect(set).toContain("A late first reply counts as missed");
    expect(set).not.toContain("committee_goals");
    expect(set).toContain("Waiting for approval means a person matched it and a second person must approve it.");
    expect(set).toContain("Every month is measured at the same age");
    expect(set).not.toMatch(/Outstanding|Total due|principal/i);
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

describe("CB6 the payment curve says what it shows (S-08) and the weekly chart writes its values (S-07)", () => {
  const quality: CollectionQuality = { bills: 10, due: 10, dueOnTime: 7, paidOnTime: 7, paid: 8, paidLate: 1, medianDaysToPay: 3 };
  const curve = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" });
  const out = html(h(QualityBlock, { ...qp, quality, curve, goal }));

  it("is titled with the month, writes the paid share at the due-date marker and says where the line stops", () => {
    expect(words(out)).toContain("How fast October's money came in");
    expect(words(out)).toContain("70% paid by the due date");
    expect(words(out)).toContain("Line stops at today.");
    expect(out.indexOf("Line stops at today.")).toBeGreaterThan(out.indexOf("</figure>") - 1);
  });

  it("the weekly chart writes every value in one row above the plot, the last one too", () => {
    const week = (weekStart: string, share: number) => ({ weekStart, raised: 3, decided: 3, met: 2, sharePercent: share, partial: false });
    const weeks = [week("2026-10-12", 67), week("2026-10-19", 80), week("2026-10-26", 75)];
    const props = { complaints: complaintMetrics([], NOW), goals: evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } }), slaGoal: goal, weeks, period: "2026-10-01", asOf: "2026-10-27", unseenAllMonths: 0, slaMinutes: { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 } };
    const chart = html(h(ComplaintsBlock, props));
    const svg = chart.slice(chart.indexOf('aria-labelledby="weekly-title weekly-desc"'));
    expect(words(svg.slice(0, svg.indexOf("</svg>")))).toContain("67% 80% 75%");
  });
});
