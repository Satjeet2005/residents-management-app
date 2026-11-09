import type { BoardRow } from "@/server/complaints/board-views";
import { t } from "@/lib/messages";
import { categoryLabel, staffStatusLabel, urgencyLabel } from "./labels";
import { durationWords } from "./time";

/** A reply due within this many minutes is worth a line on the row. */
export const DUE_SOON_MINUTES = 4 * 60;

export type RowNotice = { text: string; tone: "caution" | "neutral" };
export type RowSummary = {
  flat: string;
  /** The urgency word, only when it is not Normal. */
  urgency: { text: string; critical: boolean } | null;
  safety: boolean;
  title: string;
  /** "Plumbing · Assigned · Kavita Rao". */
  meta: string;
  /** Line 4, only when notable: overdue, due within 4 hours, or answered late. Nothing for "replied in time". */
  notice: RowNotice | null;
};

/** The notable fact of a row's reply time: overdue, due within 4 hours or answered late; null otherwise. */
export function noticeOf(row: Pick<BoardRow, "responseDueAt" | "sla">, now: number): RowNotice | null {
  if (row.responseDueAt === null) return null;
  switch (row.sla) {
    case "OVERDUE":
      return { text: t("staffComplaints.sla.overdue", { span: durationWords((now - row.responseDueAt) / 60_000) }), tone: "caution" };
    case "ON_TIME": {
      const minutes = (row.responseDueAt - now) / 60_000;
      return minutes <= DUE_SOON_MINUTES ? { text: t("staffComplaints.sla.dueIn", { span: durationWords(minutes) }), tone: "neutral" } : null;
    }
    case "LATE":
      return { text: t("staffComplaints.sla.late"), tone: "caution" };
    case "MET":
    case "NONE":
      return null;
  }
}

/** What one compact row of the board says, in four lines at most (D151). The classification source and the review flag are not on the row. */
export function rowSummary(row: BoardRow, now: number): RowSummary {
  return {
    flat: row.flatCode,
    urgency: row.urgency === "NORMAL" ? null : { text: urgencyLabel(row.urgency), critical: row.urgency === "CRITICAL" },
    safety: row.safety,
    title: row.title,
    meta: t("staffComplaints.row.meta", { category: categoryLabel(row.category), status: staffStatusLabel(row.status), assignee: row.assignee?.name ?? t("staffComplaints.unassigned") }),
    notice: noticeOf(row, now),
  };
}
