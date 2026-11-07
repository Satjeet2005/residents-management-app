import { percent } from "@/domain/reports/stats";
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
