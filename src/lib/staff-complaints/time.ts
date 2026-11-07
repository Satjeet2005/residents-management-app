import type { SlaState } from "@/domain/complaints/lifecycle";
import { istDateOf } from "@/domain/time/calendar";
import { formatClockIst, formatDay } from "@/lib/format-date";
import { t } from "@/lib/messages";

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * A span of whole minutes in short words: "5 min", "40 min", "2 h", "1 h 30 min", "3 d", "1 d 2 h". Minutes below one are "less than 1 min".
 * Rounded DOWN, so "overdue by 2 h" means at least two hours.
 */
export function durationWords(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 1) return t("staffComplaints.time.lessThanMinute");
  if (total < HOUR) return t("staffComplaints.time.min", { n: total });
  if (total < DAY) {
    const hours = Math.floor(total / HOUR);
    const rest = total % HOUR;
    return rest === 0 ? t("staffComplaints.time.hour", { n: hours }) : `${t("staffComplaints.time.hour", { n: hours })} ${t("staffComplaints.time.min", { n: rest })}`;
  }
  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  return hours === 0 ? t("staffComplaints.time.day", { n: days }) : `${t("staffComplaints.time.day", { n: days })} ${t("staffComplaints.time.hour", { n: hours })}`;
}

/** How long ago a complaint was raised, from its age in whole minutes: "40 min", "3 h", "2 d". */
export const ageWords = (ageMinutes: number): string => durationWords(ageMinutes);

/**
 * The reply clock in words. ON_TIME: "Reply due in 40 min". OVERDUE: "Reply overdue by 2 h". MET: "Replied in time". NONE: "No reply clock" (a closed
 * complaint). Both clocks are in milliseconds since the epoch.
 */
export function slaWords(input: { sla: SlaState; responseDueAt: number | null; now: number }): string {
  const { sla, responseDueAt, now } = input;
  if (responseDueAt === null) return t("staffComplaints.sla.none");
  switch (sla) {
    case "ON_TIME":
      return t("staffComplaints.sla.dueIn", { span: durationWords((responseDueAt - now) / 60_000) });
    case "OVERDUE":
      return t("staffComplaints.sla.overdueBy", { span: durationWords((now - responseDueAt) / 60_000) });
    case "MET":
      return t("staffComplaints.sla.met");
    case "NONE":
      return t("staffComplaints.sla.none");
  }
}

/** An instant as "6 Nov, 12:00 pm" in India time, for the clocks and the timeline. */
export const whenWords = (instant: number): string => t("staffComplaints.when", { date: formatDay(istDateOf(instant)), time: formatClockIst(instant) });
