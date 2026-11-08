import { percent } from "@/domain/reports/stats";
import type { SlaMinutes } from "@/domain/complaints/lifecycle";
import { t } from "@/lib/messages";
import { durationWords } from "@/lib/staff-complaints/time";

/** `n` out of `d` as the screen says it: "87%", or "No data" when there is nothing to take a share of (never "0%"). */
export const shareText = (n: number, d: number): string => {
  const value = percent(n, d);
  return value === null ? t("committee.noData") : t("committee.percent", { n: value });
};

/** A median in whole minutes as words ("94 min", "1 h 34 min"), or "No data" when there is none. */
export const minutesText = (minutes: number | null): string => (minutes === null ? t("committee.noData") : durationWords(minutes));

/** A median in whole days ("1 day", "3 days"), or "No data". */
export const daysText = (days: number | null): string => (days === null ? t("committee.noData") : days === 1 ? t("committee.day") : t("committee.days", { n: days }));

/** A promised time in the units the society says it in: "15 min", "2 h", "24 h", "72 h" (whole hours stay hours, never days). */
const promiseWords = (minutes: number): string => (minutes % 60 === 0 && minutes >= 60 ? t("staffComplaints.time.hour", { n: minutes / 60 }) : durationWords(minutes));

/** "Promise: Critical 15 min, High 2 h, Normal 24 h, Low 72 h", from the society's `sla_minutes` setting. */
export const promiseText = (sla: SlaMinutes): string =>
  t("committee.complaints.promise", { critical: promiseWords(sla.CRITICAL), high: promiseWords(sla.HIGH), normal: promiseWords(sla.NORMAL), low: promiseWords(sla.LOW) });
