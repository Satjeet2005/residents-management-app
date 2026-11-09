import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { ComplaintsBlock } from "@/app/(staff)/staff/reports/complaints-block";
import { QualityBlock } from "@/app/(staff)/staff/reports/quality-block";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { ReconciliationBlock } from "@/app/(staff)/staff/reports/reconciliation-block";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import { en } from "@/lib/messages/en";
import { SECTIONS } from "@/lib/reports/sections";
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

describe("CB1 collection quality: exactly three rows, no secondary figure, no 'paid late' (D209)", () => {
  const quality: CollectionQuality = { bills: 2399, due: 2399, dueOnTime: 1687, paidOnTime: 1687, paid: 1915, paidLate: 228, medianDaysToPay: 3 };
  const curve = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [{ date: "2026-10-03", amountPaise: 700_000n }] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-27" });
  const out = html(h(QualityBlock, { ...qp, quality, curve, goal }));
  const text = words(out);

  it("shows the bills paid by the due date with its count and its goal, half of paid bills within so many days, and the money collected by the due date", () => {
    expect(text).toContain("Bills paid by the due date 1,687 of 2,399 bills Goal 90%");
    expect(text).toContain("70%");
    expect(text).toContain("Half of paid bills are paid within 3 days");
    expect(text).toContain("Money collected by the due date 70%");
  });

  it("has exactly three rows, no 'Paid late' row, no definition under a figure and no 'middle value'", () => {
    expect(count(out, /<dd class="tnum shrink-0/g)).toBe(3);
    expect(text).not.toMatch(/Paid late|middle value|Typical/);
    expect(text).not.toContain("paid on or before their due date");
  });

  it("the secondary figure 'of bills that were paid' and the paragraph of three plain numbers are not on the page (the first lives in the expander, D209)", () => {
    expect(text).not.toContain("Of bills that were paid");
    expect(text).not.toContain("Share of October's money collected");
    expect(text).not.toContain("88%");
  });

  it("says Met or Not met with the goal, in words and an icon", () => {
    expect(words(html(h(QualityBlock, { ...qp, quality, curve, goal: metGoal })))).toContain("Met");
    const notMet = html(h(QualityBlock, { ...qp, quality, curve, goal: { ...goal, status: "NOT_MET" as const } }));
    expect(words(notMet)).toContain("Not met");
    expect(notMet).toContain("<svg");
  });

  it("the curve is drawn from 768px only, as another form of the money-by-the-due-date figure", () => {
    expect(out).toContain('<div data-figure-form="moneyByDue" class="hidden md:block"><figure');
    expect(out).toContain('aria-labelledby="curve-title curve-desc"');
  });

  it("before the due date the third row says 'not yet due'", () => {
    const early = paymentCurve({ bills: [{ amountPaise: 1_000_000n, payments: [] }], issueDate: "2026-10-01", dueDate: "2026-10-10", asOf: "2026-10-05" });
    expect(words(html(h(QualityBlock, { ...qp, quality, curve: early, goal })))).toContain("Money collected by the due date not yet due");
  });

  it("says 'No data' in words, never 0%, when there is nothing to measure", () => {
    const none = words(html(h(QualityBlock, { ...qp, quality: { bills: 0, due: 0, dueOnTime: 0, paidOnTime: 0, paid: 0, paidLate: 0, medianDaysToPay: null }, curve: null, goal: { ...goal, status: "NO_DATA" } })));
    expect(none).toContain("Bills paid by the due date Goal 90% No data");
    expect(none).toContain("Half of paid bills are paid within No data");
    expect(none).toContain("Money collected by the due date No data");
    expect(none).not.toMatch(NO_ZERO);
  });

  it("one day is '1 day'", () => {
    expect(words(html(h(QualityBlock, { ...qp, quality: { ...quality, medianDaysToPay: 1 }, curve: null, goal })))).toContain("within 1 day");
  });
});

const ledgerNumbers = (markup: string): number[] => [...markup.matchAll(/<dd class="tnum shrink-0[^>]*>([\d,]+)<\/dd>/g)].map((m) => Number(m[1].replace(/,/g, "")));

describe("CB2 complaints: four blocks, two ledgers (D211)", () => {
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

  it("has four blocks with these h2s, and the promise line once", () => {
    expect([...out.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1].replace("&#x27;", "'"))).toEqual(["Replies", "Resolution", "Where October's complaints stand", "Safety complaints, October"]);
    expect(text).toContain("Promise: Critical 15 min · High 2 h · Normal 24 h · Low 72 h");
    expect(count(text, /Promise:/g)).toBe(1);
  });

  it("Replies and Resolution carry their rows: replied in time with its count and goal, half of first replies, half marked resolved, reopened with its limit", () => {
    expect(text).toContain("Replied in time 3 of 5 replies due Goal 90% 60%");
    expect(text).toContain("Half of first replies come within 30 min");
    expect(text).toContain("Half are marked resolved within 2 h");
    expect(text).toContain("Reopened after being marked resolved 1 of 2 resolved Limit 8% · 42 points over Not met");
  });

  it("the ledger of where the complaints stand lists the parts and adds up to Raised, and the old rows and sentences are gone", () => {
    expect(text).toContain("Closed by the resident 1 + plus Closed automatically 1 + plus Closed by the duty manager 0 + plus Still open 3 = equals Raised 5");
    const stand = out.slice(out.indexOf('aria-labelledby="committee-stand"'), out.indexOf('aria-labelledby="committee-safety"'));
    const [resident, automatic, duty, open, raised] = ledgerNumbers(stand);
    expect(resident + automatic + duty + open).toBe(raised);
    expect(text).not.toMatch(/Open now|Raised = closed|by the resident, \d|automatically after no reply|\(the middle value\)|Typical/);
  });

  it("a remainder is shown as an 'Other' line, never hidden", () => {
    const odd = { ...metrics, openNow: 1 };
    const stand = words(html(h(ComplaintsBlock, { ...props, complaints: odd })));
    expect(stand).toContain("+ plus Other 2 = equals Raised 5");
    expect(words(html(h(ComplaintsBlock, props)))).not.toContain("Other");
  });

  it("the safety ledger adds up to Raised, the time to the first sight shows only when there is one", () => {
    const safety = out.slice(out.indexOf('aria-labelledby="committee-safety"'));
    expect(words(safety)).toContain("Closed by the duty manager 0 + plus Open, seen by the duty manager 1 + plus Open, not yet seen 1 = equals Raised 2");
    const [duty, seen, notSeen, raised] = ledgerNumbers(safety);
    expect(duty + seen + notSeen).toBe(raised);
    expect(words(safety)).toContain("Half are seen within 5 min");
    expect(words(html(h(ComplaintsBlock, { ...props, complaints: complaintMetrics([c({ safetyFlag: true })], NOW) })))).not.toContain("Half are seen within");
  });

  it("the all-months row shows only when it differs from this month's 'Open, not yet seen' line, and then in alert styling (D171)", () => {
    expect(text).not.toContain("all months");
    expect(out).not.toContain("border-caution");
    const differs = html(h(ComplaintsBlock, { ...props, unseenAllMonths: 4 }));
    expect(words(differs)).toContain("Open, not yet seen, all months 4");
    expect(differs).toContain("border-caution");
    expect(words(html(h(ComplaintsBlock, { ...props, unseenAllMonths: 0 })))).toContain("Open, not yet seen, all months 0");
  });

  it("a complaint closed by the duty manager is seen; a month without safety complaints says so", () => {
    const closed = c({ safetyFlag: true, status: "CLOSED", closeKind: "DUTY_MANAGER", closedAt: T0 + 20 * minute });
    const all = words(html(h(ComplaintsBlock, { ...props, unseenAllMonths: 0, complaints: complaintMetrics([closed], NOW) })));
    expect(all).toContain("Closed by the duty manager 1 + plus Open, seen by the duty manager 0 + plus Open, not yet seen 0 = equals Raised 1");
    expect(all).toContain("Half are seen within 20 min");
    expect(words(html(h(ComplaintsBlock, { ...props, complaints: complaintMetrics([c()], NOW) })))).toContain("No safety complaints were raised.");
  });

  it("every value is on one line: a non-breaking space between number and unit and nowrap", () => {
    expect(out).toContain("30\u00A0min");
    for (const dd of out.match(/<dd [^>]*>/g) ?? []) expect(dd).toContain("whitespace-nowrap");
  });

  it("the weekly chart is drawn from 768px only, with its own table, and only when some week has a share to draw", () => {
    const week = (weekStart: string, share: number | null) => ({ weekStart, raised: 3, decided: share === null ? 0 : 3, met: share === null ? 0 : 2, sharePercent: share, partial: false });
    const drawn = html(h(ComplaintsBlock, { ...props, weeks: [week("2026-10-12", 67), week("2026-10-19", null)] }));
    expect(drawn).toContain('<div data-figure-form="weekly" class="hidden md:block"><figure');
    expect(drawn).toContain('aria-labelledby="weekly-title weekly-desc"');
    expect(out).not.toContain("weekly-title");
  });

  it("a month with no complaints says so once, shows no zero percent and no safety block", () => {
    const none = words(html(h(ComplaintsBlock, { ...props, complaints: complaintMetrics([], NOW) })));
    expect(none).toContain("No complaints were raised in this month.");
    expect(none).not.toMatch(NO_ZERO);
    expect(none).not.toContain("afety");
  });

  it("zero denominators say 'No data': nothing replied, nothing resolved", () => {
    const noGoals = evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } });
    const text2 = words(html(h(ComplaintsBlock, { ...props, goals: noGoals, complaints: complaintMetrics([c({ responseDueAt: NOW + 60 * minute })], NOW) })));
    expect(text2).toContain("Half of first replies come within No data");
    expect(text2).toContain("Replied in time Goal 90% No data");
    expect(text2).toContain("Half are marked resolved within No data");
    expect(text2).toContain("Reopened after being marked resolved Limit 8% No data");
  });
});

describe("CB3 the bank reconciliation: one ledger that adds up, then the check, then the table only when needed (D212)", () => {
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

  it("is ONE ledger that accounts for every bank entry and adds up to the entries", () => {
    expect(text).toContain("Matched automatically 25 + plus Matched by hand 3 + plus Waiting for a person 42 + plus Waiting for approval 1 + plus Not maintenance payments 35 = equals Bank entries 106");
    const [auto, hand, person, approval, other, total] = ledgerNumbers(out);
    expect(auto + hand + person + approval + other).toBe(total);
    expect(count(out, /<li>/g)).toBe(0);
    expect(text).not.toContain("Matched by hand (last 30 days)");
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

  it("with every count at zero there is no table, the by-hand line says 0, and the line for approval is left out", () => {
    expect(html(h(ReconciliationBlock, { line: none }))).not.toContain("<table");
    const plain = reconciliationLine({ states: { QUEUED: 44, AUTO_MATCHED: 24, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 38 }, imports: [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
    const quiet = words(html(h(ReconciliationBlock, { line: plain })));
    expect(quiet).toContain("Matched by hand 0");
    expect(quiet).toContain("Matched automatically 24 + plus Matched by hand 0 + plus Waiting for a person 44 + plus Not maintenance payments 38 = equals Bank entries 106");
    expect(quiet).toContain("All 106 accounted for");
    expect(quiet).not.toContain("Waiting for approval");
  });

  it("the tick is not shown when an import does not add up, and 1,000 entries are grouped", () => {
    const bad = words(html(h(ReconciliationBlock, { line: reconciliationLine({ states: { ...states, QUEUED: 1000 }, imports: [{ rowsRead: 5, stored: 4, invalidRows: 0, alreadyImported: 0 }], decisions: [] }) })));
    expect(bad).not.toContain("accounted for");
    expect(bad).toContain("Waiting for a person 1,000");
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

describe("CB4 the About block is retired (D207)", () => {
  it("no page carries an About block, a link to one, or the words that pointed to it", () => {
    const pages = [html(h(ReportView, { report: emptyReport() })), ...SECTIONS.map((section) => html(h(SectionPage, { slug: section.slug, report: emptyReport() })))].join("\n");
    expect(words(pages)).not.toMatch(/About these numbers|What these words mean|What each figure means/);
    expect(pages).not.toMatch(/id="about"|href="[^"]*#about"|committee-about/);
  });

  it("the component, its catalog keys and its pointer are gone", () => {
    expect(existsSync(path.resolve(process.cwd(), "src/app/(staff)/staff/reports/about-block.tsx"))).toBe(false);
    expect(Object.keys(en).filter((key) => /^committee\.(about\.|words\.)/.test(key))).toEqual([]);
  });
});

describe("CB5 the four section pages", () => {
  const out = SECTIONS.map((section) => html(h(SectionPage, { slug: section.slug, report: emptyReport() }))).join("\n");

  it("with an empty month and no complaints or imports it says so in each section and has no zero percent and no 'NaN'", () => {
    expect(words(out)).toContain("No bills for this month");
    expect(words(out)).toContain("No complaints were raised in this month.");
    expect(words(out)).toContain("No bank statement was imported in the last 30 days.");
    expect(out).not.toMatch(/NaN|undefined|null/);
    expect(words(out)).not.toMatch(NO_ZERO);
  });

  it("each page has exactly one h1, a back link to the committee report, and no collapsible section; there is no Goals section", () => {
    const pages = out.split("<main").slice(1);
    expect(pages).toHaveLength(4);
    for (const page of pages) {
      expect(count(page, /<h1/g)).toBe(1);
      expect(page).toContain('aria-label="Back to the committee report"');
      expect(page).not.toContain("data-section");
    }
    expect(out).not.toMatch(/<h2[^>]*>Goals<\/h2>/);
    expect(words(out)).not.toContain("Goals against");
  });

  it("uses no uppercase, no letter-spacing and no filled control", () => {
    expect(out).not.toMatch(/uppercase|tracking-/);
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
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
