/** How a complaint stands against its first-reply due time. The one definition every SLA figure uses (D150). */
export type SlaOutcome = "MET" | "MISSED_LATE" | "MISSED_OPEN" | "NOT_DUE";

/**
 * MET: the first reply came at or before the due time. MISSED_LATE: it came after. MISSED_OPEN: there is no reply and the due time has passed.
 * NOT_DUE: there is no reply and the due time has not passed, or there is no due time at all (no SLA applies). All times are milliseconds since the
 * epoch; a reply exactly at the due time is MET, and `now` equal to the due time has not passed it. A MISSED_LATE complaint stays missed for ever.
 */
export function slaOutcome(input: { responseDueAt: number | null; firstResponseAt: number | null; now: number }): SlaOutcome {
  const { responseDueAt: due, firstResponseAt: first, now } = input;
  if (due === null) return "NOT_DUE";
  if (first !== null) return first <= due ? "MET" : "MISSED_LATE";
  return now > due ? "MISSED_OPEN" : "NOT_DUE";
}

/** The outcomes that count in "replied within the SLA": everything except NOT_DUE. */
export const isDecided = (outcome: SlaOutcome): boolean => outcome !== "NOT_DUE";
