import { t } from "@/lib/messages";
import { categoryLabel, sourceName, urgencyLabel } from "./labels";
import type { TimelineLine } from "./timeline";
import type { ClassificationLine } from "@/server/complaints/staff-read";

export const DETAIL_TABS = ["details", "timeline"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** The tab named by `?tab=`: only the two names are accepted, anything else (or a repeated value, the first is read) is Details. */
export function tabFromQuery(value: string | string[] | undefined): DetailTab {
  const text = Array.isArray(value) ? value[0] : value;
  return DETAIL_TABS.find((tab) => tab === text) ?? "details";
}

export const RECENT_EVENTS = 3;

/** The timeline for the tab: the latest three events, newest first, and the earlier ones (newest first) for the "Show all" expander. */
export function trimTimeline(lines: readonly TimelineLine[], recent: number = RECENT_EVENTS): { recent: TimelineLine[]; earlier: TimelineLine[] } {
  const newestFirst = [...lines].sort((a, b) => b.at - a.at);
  return { recent: newestFirst.slice(0, recent), earlier: newestFirst.slice(recent) };
}

/** How it was classified, in one line: "Rules · Lift · Critical". The newest classification; null when there is none. */
export function classificationOneLine(latest: ClassificationLine | undefined): string | null {
  return latest === undefined ? null : t("staffComplaints.classification.oneLine", { source: sourceName(latest.source), category: categoryLabel(latest.category), urgency: urgencyLabel(latest.urgency) });
}
