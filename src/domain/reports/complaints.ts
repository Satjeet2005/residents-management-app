import { isDecided, slaOutcome } from "../complaints/sla";
import { medianOf } from "./stats";

/** What the report needs of one complaint raised in the month. Times are milliseconds since the epoch; the two event times come from the complaint's events. */
export type ReportComplaint = {
  createdAt: number;
  safetyFlag: boolean;
  status: "NEW" | "ASSIGNED" | "IN_PROGRESS" | "PENDING_CONFIRMATION" | "CLOSED" | "REOPENED";
  closeKind: "CONFIRMED" | "AUTO_CLOSED" | "DUTY_MANAGER" | null;
  responseDueAt: number | null;
  firstResponseAt: number | null;
  reopenCount: number;
  /** The first time it was marked resolved (the first STATUS_CHANGED to PENDING_CONFIRMATION), or null. A reopen clears the complaint's own time, so the event is used. */
  resolvedAt: number | null;
  /** The first acknowledgement by the duty manager (an event), or null. Only a safety complaint has one. */
  acknowledgedAt: number | null;
};

export type ComplaintMetrics = {
  raised: number;
  firstReply: {
    /** Complaints somebody replied to, and the median minutes from raising to the first reply. */
    replied: number;
    medianMinutes: number | null;
    /** MET + MISSED_LATE + MISSED_OPEN (`slaOutcome`, D150): replied on time, replied late, or unreplied past the due time. NOT_DUE is left out. */
    decided: number;
    /** Of those, the ones replied to by the due time (MET): a late first reply is not within the SLA. */
    withinSla: number;
  };
  resolved: {
    /** Complaints that were marked resolved at least once, the median minutes from raising to the first time, and how many of them were reopened. */
    count: number;
    medianMinutes: number | null;
    reopened: number;
  };
  /** Of the complaints now closed: closed by the resident's confirmation, and closed by itself after no answer (D15). A closure by the duty manager is in neither. */
  closed: { byResident: number; automatically: number };
  /** Complaints of the month that are not closed now. */
  openNow: number;
  safety: { count: number; acknowledged: number; medianMinutesToAcknowledge: number | null; unacknowledgedNow: number };
};

const minutesBetween = (from: number, to: number): number => Math.max(0, Math.floor((to - from) / 60_000));

/**
 * The complaint figures of a month from its complaints (D5, D120). Times are in whole minutes (rounded down) and a median takes the lower middle value
 * (`medianOf`). A share is left to the caller to take with `percent`, which says "no data" for a zero denominator: this returns the counts. `now` is the business
 * clock: it decides whether an unreplied complaint is already past its due time.
 */
export function complaintMetrics(complaints: readonly ReportComplaint[], now: number): ComplaintMetrics {
  const replied = complaints.filter((c) => c.firstResponseAt !== null);
  const outcomes = complaints.map((c) => slaOutcome({ responseDueAt: c.responseDueAt, firstResponseAt: c.firstResponseAt, now }));
  const decided = outcomes.filter(isDecided);
  const resolved = complaints.filter((c) => c.resolvedAt !== null);
  const safety = complaints.filter((c) => c.safetyFlag);
  const acknowledged = safety.filter((c) => c.acknowledgedAt !== null);
  return {
    raised: complaints.length,
    firstReply: {
      replied: replied.length,
      medianMinutes: medianOf(replied.map((c) => minutesBetween(c.createdAt, c.firstResponseAt as number))),
      decided: decided.length,
      withinSla: outcomes.filter((o) => o === "MET").length,
    },
    resolved: {
      count: resolved.length,
      medianMinutes: medianOf(resolved.map((c) => minutesBetween(c.createdAt, c.resolvedAt as number))),
      reopened: resolved.filter((c) => c.reopenCount > 0).length,
    },
    closed: {
      byResident: complaints.filter((c) => c.status === "CLOSED" && c.closeKind === "CONFIRMED").length,
      automatically: complaints.filter((c) => c.status === "CLOSED" && c.closeKind === "AUTO_CLOSED").length,
    },
    openNow: complaints.filter((c) => c.status !== "CLOSED").length,
    safety: {
      count: safety.length,
      acknowledged: acknowledged.length,
      medianMinutesToAcknowledge: medianOf(acknowledged.map((c) => minutesBetween(c.createdAt, c.acknowledgedAt as number))),
      unacknowledgedNow: safety.filter((c) => c.status !== "CLOSED" && c.acknowledgedAt === null).length,
    },
  };
}
