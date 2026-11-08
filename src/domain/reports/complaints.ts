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
  /** When it was closed (the complaint's own time), or null while it is open. */
  closedAt: number | null;
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
  /**
   * Where every complaint of the month stands (D172): closed by the resident's confirmation, closed automatically after no reply (D15), closed by the duty
   * manager, closed with no kind recorded (`other`, never hidden), or still open. byResident + automatically + byDutyManager + other + openNow = raised, always.
   */
  closed: { byResident: number; automatically: number; byDutyManager: number; other: number };
  /** Complaints of the month that are not closed now. */
  openNow: number;
  safety: SafetyBreakdown;
};

/**
 * The safety complaints of the month by what became of them (D171). A safety complaint is SEEN when the duty manager acknowledged it or closed it. The three
 * groups of the committee page, closedByDutyManager + openSeen + openNotSeen, add up to `count`; a safety complaint closed another way (by the resident or
 * automatically) fits none of them and is `closedOtherWay`, so closedByDutyManager + openSeen + openNotSeen + closedOtherWay = count, always.
 */
export type SafetyBreakdown = {
  count: number;
  closedByDutyManager: number;
  openSeen: number;
  openNotSeen: number;
  closedOtherWay: number;
  /** The median minutes from raising to the first sight (the acknowledgement or the duty manager's closing, whichever came first) over the seen complaints; null when none. */
  medianMinutesToSeen: number | null;
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
  const minutesToSeen = safety.flatMap((c) => {
    const closedByManager = c.status === "CLOSED" && c.closeKind === "DUTY_MANAGER" ? c.closedAt : null;
    const times = [c.acknowledgedAt, closedByManager].filter((x): x is number => x !== null);
    return times.length === 0 ? [] : [minutesBetween(c.createdAt, Math.min(...times))];
  });
  const isOpen = (c: ReportComplaint) => c.status !== "CLOSED";
  const closedBy = (kind: ReportComplaint["closeKind"]) => (c: ReportComplaint) => c.status === "CLOSED" && c.closeKind === kind;
  const byManager = safety.filter(closedBy("DUTY_MANAGER")).length;
  const openSeen = safety.filter((c) => isOpen(c) && c.acknowledgedAt !== null).length;
  const openNotSeen = safety.filter((c) => isOpen(c) && c.acknowledgedAt === null).length;
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
      byResident: complaints.filter(closedBy("CONFIRMED")).length,
      automatically: complaints.filter(closedBy("AUTO_CLOSED")).length,
      byDutyManager: complaints.filter(closedBy("DUTY_MANAGER")).length,
      other: complaints.filter(closedBy(null)).length,
    },
    openNow: complaints.filter(isOpen).length,
    safety: {
      count: safety.length,
      closedByDutyManager: byManager,
      openSeen,
      openNotSeen,
      closedOtherWay: safety.length - byManager - openSeen - openNotSeen,
      medianMinutesToSeen: medianOf(minutesToSeen),
    },
  };
}
