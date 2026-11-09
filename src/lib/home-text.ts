import type { Dues, OpenBill } from "@/domain/billing/dues";
import type { FeeWorking } from "@/domain/billing/working";
import { formatRupees, formatRupeesRounded } from "@/domain/money/money";
import { istDateOf } from "@/domain/time/calendar";
import type { EntryType, ReplyDue } from "@/server/home/types";
import { formatDay, formatTimeIst, monthName } from "./format-date";
import { t } from "./messages";

/** "Reply due today, 5 pm", "Reply due 28 Oct, 5 pm" or "Reply overdue". The times are India time. */
export function replyDueText(reply: ReplyDue): string {
  if (reply.kind === "OVERDUE") return t("complaint.reply.overdue");
  const time = formatTimeIst(reply.dueAt);
  return reply.today ? t("complaint.reply.dueToday", { time }) : t("complaint.reply.dueOn", { date: formatDay(istDateOf(reply.dueAt)), time });
}

// --- Dues, entries and complaints, in words (no Intl, no plural library: a plural is a second key) ---


export const overdueText = (days: number): string => (days === 1 ? t("dues.overdueOne", { days: 1 }) : t("dues.overdue", { days }));

/**
 * The tag on the dues card: "47 days overdue" in caution, "Due 10 Nov, in 14 days", or the late-fee-due tag when the oldest open
 * bill's principal is paid and only its fee is owed (D107). Null when nothing is open.
 */
export function dueTag(dues: Dues): { tone: "caution" | "neutral"; text: string } | null {
  if (dues.oldest === null) return null;
  if (dues.openBills[0].kind === "FEE_ONLY") return { tone: "caution", text: t("dues.lateFeeDue") };
  if (dues.oldest.overdueDays > 0) return { tone: "caution", text: overdueText(dues.oldest.overdueDays) };
  const date = formatDay(dues.oldest.dueOn);
  const days = dues.oldest.daysUntilDue;
  if (days === 0) return { tone: "neutral", text: t("dues.dueToday", { date }) };
  return { tone: "neutral", text: days === 1 ? t("dues.dueInOne", { date, days: 1 }) : t("dues.dueIn", { date, days }) };
}

/** "₹5,000 paid on 12 Oct. ₹5,660 still due, plus ₹38 late fee." */
export function partlyPaidText(partly: NonNullable<Dues["partlyPaid"]>): string {
  const params = { paid: formatRupees(partly.paidPaise), date: formatDay(partly.lastPaidOn), still: formatRupees(partly.stillDuePaise), fee: formatRupees(partly.feePaise) };
  return partly.feePaise > 0n ? t("dues.partlyPaid", params) : t("dues.partlyPaidNoFee", params);
}

export function entryLabel(type: EntryType): string {
  switch (type) {
    case "BILL":
      return t("entry.bill");
    case "PAYMENT":
      return t("entry.payment");
    case "LATE_FEE":
      return t("entry.lateFee");
    case "REVERSAL":
      return t("entry.reversal");
    case "ADJUSTMENT":
      return t("entry.adjustment");
  }
}

/** "Step 2 of 4. Reply due today, 5 pm", or just "Step 2 of 4" once someone has replied. */
export function complaintStepLine(step: number, total: number, reply: ReplyDue | null): string {
  return reply === null ? t("complaint.stepOnly", { n: step, total }) : t("complaint.stepLine", { n: step, total, reply: replyDueText(reply) });
}

export function otherComplaintsText(count: number): string {
  return count === 1 ? t("complaint.otherOne", { n: 1 }) : t("complaint.otherMany", { n: count });
}

/** The lines of the working box for one bill: each stretch of days, then the exact fee and what is charged. */
export function workingLines(bill: OpenBill, working: FeeWorking): { name: string; segments: string[]; total: string } {
  const segments = working.segments.map((s) => {
    const params = { base: formatRupees(s.basePaise), rate: working.rateText, days: s.days, year: working.daysInYear };
    return s.days === 1 ? t("working.segmentOne", params) : t("working.segment", params);
  });
  const exact = formatRupees(working.exactPaise);
  const rounded = formatRupees(working.roundedPaise);
  return { name: t("working.billName", { month: monthName(bill.period) }), segments, total: exact === rounded ? t("working.totalSame", { rounded }) : t("working.total", { exact, rounded }) };
}

/** "It grows by about ₹2 a day until you pay." Only for one open bill, and only when a day's growth rounds to at least a rupee. */
export function dailyGrowthText(dues: Dues): string | null {
  if (dues.openBills.length !== 1 || dues.openBills[0].kind === "FEE_ONLY") return null;
  const working = dues.openBills[0].working;
  if (working === null) return null;
  const amount = formatRupeesRounded(working.dailyPaise);
  return amount === formatRupees(0n) ? null : t("working.daily", { amount });
}
