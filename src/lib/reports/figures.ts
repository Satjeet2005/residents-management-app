import { t } from "@/lib/messages";
import { percent } from "@/domain/reports/stats";
import type { CommitteeReport } from "@/server/reports/report-data";
import { monthName } from "@/lib/format-date";
import { reconcileLine, reconcilingGroup } from "./ageing";
import { countText } from "./cards";
import type { SectionSlug } from "./sections";

/**
 * The FIGURE-DEFINITION REGISTRY (D207): every figure any committee page can render, each mapped to the catalog key of its definition. A figure row carries
 * `data-figure="<id>"`; the page's ONE expander lists a line for each figure the page shows, in the order below. A test renders every page and fails when a
 * figure shown has no line in THAT page's expander, or when a definition sits outside the expander. The full definitions are in docs/committee-report.md.
 */
export const FIGURE_DEFINITIONS = {
  general: () => t("committee.def.general"),
  cardCollected: (report) => t("committee.def.cardCollected", { month: monthName(report.period) }),
  cardOwed: () => t("committee.def.cardOwed"),
  cardOnTime: () => t("committee.def.cardOnTime"),
  cardReplied: () => t("committee.def.cardReplied"),
  goalsDefault: (report) => t("committee.goals.default", { a: report.goals.rows[0].targetPercent, b: report.goals.rows[1].targetPercent, c: report.goals.rows[2].targetPercent }),
  billed: () => t("committee.def.billed"),
  collected: () => t("committee.def.collected"),
  unpaid: () => t("committee.def.unpaid"),
  paidByDue: () => t("committee.def.paidByDue"),
  paidOfPaid: (report) => paidOfPaid(report),
  medianDays: () => t("committee.def.medianDays"),
  moneyByDue: () => t("committee.def.moneyByDue"),
  within20: () => t("committee.def.within20"),
  owedTotal: () => t("committee.def.owedTotal"),
  ageMeaning: () => t("committee.def.ageMeaning"),
  ageGroups: () => t("committee.def.ageGroups"),
  ageReconcile: (report) => reconcileLine(report.ageing, report.money, report.period) ?? "",
  lateFeesReceived: () => t("committee.def.lateFeesReceived"),
  duesReceived: () => t("committee.def.duesReceived"),
  duesCharged: () => t("committee.def.duesCharged"),
  duesBuilding: () => t("committee.def.duesBuilding"),
  towers: () => t("committee.def.towers"),
  firstReply: () => t("committee.def.firstReply"),
  repliedInTime: () => t("committee.def.repliedInTime"),
  resolved: () => t("committee.def.resolved"),
  reopened: () => t("committee.def.reopened"),
  closedAuto: (report) => t("committee.def.closedAuto", { n: report.autoCloseDays }),
  closedDuty: () => t("committee.def.closedDuty"),
  seen: () => t("committee.def.seen"),
  ledger: () => t("committee.def.ledger"),
  weekly: () => t("committee.def.weekly"),
  bankWindow: () => t("committee.def.bankWindow"),
  bankAuto: () => t("committee.def.bankAuto"),
  bankHand: () => t("committee.def.bankHand"),
  bankPerson: () => t("committee.def.bankPerson"),
  bankApproval: () => t("committee.def.bankApproval"),
  bankOther: () => t("committee.def.bankOther"),
  bankAccounted: () => t("committee.def.bankAccounted"),
} as const satisfies Record<string, (report: CommitteeReport) => string>;

export type FigureId = keyof typeof FIGURE_DEFINITIONS;
export type PageId = "overview" | SectionSlug;
export type DefinitionLine = { id: FigureId; text: string };

/** The figure ids each page can show, in the order of its expander. A page's expander never lists an id that is not declared here. */
export const PAGE_FIGURES: Record<PageId, readonly FigureId[]> = {
  overview: ["general", "cardCollected", "cardOwed", "cardOnTime", "cardReplied", "goalsDefault"],
  collections: ["billed", "collected", "unpaid", "lateFeesReceived", "paidByDue", "paidOfPaid", "medianDays", "moneyByDue", "within20"],
  dues: ["owedTotal", "ageMeaning", "ageGroups", "ageReconcile", "duesReceived", "duesCharged", "duesBuilding", "towers"],
  complaints: ["firstReply", "repliedInTime", "resolved", "reopened", "closedAuto", "closedDuty", "seen", "ledger", "weekly"],
  bank: ["bankWindow", "bankAuto", "bankHand", "bankPerson", "bankApproval", "bankOther", "bankAccounted"],
};

/** The ids the expander of a page lists for this report: the figures the page really shows (a figure that is not drawn has no line). */
export function shownFigures(page: PageId, report: CommitteeReport): FigureId[] {
  const { complaints, reconciliation: bank, quality } = report;
  const money = report.money !== null;
  const hasOwed = report.ageing.total.bills > 0;
  const hasComplaints = complaints.raised > 0;
  const hasBank = bank.imports > 0 && bank.rowsImported > 0;
  const flags: Record<FigureId, boolean> = {
    general: true,
    cardCollected: true,
    cardOwed: true,
    cardOnTime: true,
    cardReplied: true,
    goalsDefault: report.goals.source === "DEFAULT",
    billed: money,
    collected: money,
    unpaid: money,
    paidByDue: quality !== null,
    paidOfPaid: quality !== null && quality.paid > 0,
    medianDays: quality !== null,
    moneyByDue: quality !== null,
    within20: money,
    owedTotal: true,
    ageMeaning: hasOwed,
    ageGroups: hasOwed,
    ageReconcile: hasOwed && reconcilingGroup(report.ageing, report.money) !== null,
    lateFeesReceived: money,
    duesReceived: true,
    duesCharged: true,
    duesBuilding: true,
    towers: report.towers.towers.length > 0,
    firstReply: hasComplaints,
    repliedInTime: hasComplaints,
    resolved: hasComplaints,
    reopened: hasComplaints,
    closedAuto: hasComplaints,
    closedDuty: hasComplaints,
    seen: hasComplaints && (complaints.safety.count > 0 || report.safetyUnacknowledged !== 0),
    ledger: hasComplaints,
    weekly: report.series.weeklySla.some((w) => w.sharePercent !== null),
    bankWindow: true,
    bankAuto: hasBank,
    bankHand: hasBank,
    bankPerson: hasBank,
    bankApproval: hasBank && bank.waitingForApproval > 0,
    bankOther: hasBank,
    bankAccounted: hasBank && bank.allAccounted === true,
  };
  return PAGE_FIGURES[page].filter((id) => flags[id]);
}

/** "Of bills that were paid, 88% were paid on time (1,687 of 1,915). This ignores the 484 bills not yet paid.": computed, shown in the expander only. Empty when there is no quality. */
function paidOfPaid(report: CommitteeReport): string {
  const q = report.quality;
  if (q === null) return "";
  return t("committee.def.paidOfPaid", { p: percent(q.paidOnTime, q.paid) ?? 0, n: countText(q.paidOnTime), d: countText(q.paid), u: countText(q.bills - q.paid) });
}

/** The lines of the expander of a page: one per figure the page shows. */
export const definitionLinesFor = (page: PageId, report: CommitteeReport): DefinitionLine[] => shownFigures(page, report).map((id) => ({ id, text: FIGURE_DEFINITIONS[id](report) }));
