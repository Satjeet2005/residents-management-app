import type { ReportComplaint } from "@/domain/reports/complaints";
import { type CalendarDate, addDays, dayStartInstant } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";
import { monthStart } from "@/lib/reports/period";

/** The first day of the month after a period. */
const nextMonth = (period: CalendarDate): CalendarDate => monthStart(addDays(period, 31));

/**
 * The complaints raised in a month (by created_at, India time) with the two times the report needs from their events: the first time each was marked resolved
 * and the first acknowledgement by the duty manager. TWO queries however many complaints there are: the complaints, and one query for those events (the
 * relation filter keeps it to the month). Reads only (the app role has SELECT on both tables).
 */
export async function loadMonthComplaints(db: Db, period: CalendarDate): Promise<ReportComplaint[]> {
  const created = { gte: new Date(dayStartInstant(period)), lt: new Date(dayStartInstant(nextMonth(period))) };
  const [rows, events] = await Promise.all([
    db.complaint.findMany({
      where: { createdAt: created },
      select: { id: true, createdAt: true, safetyFlag: true, status: true, closeKind: true, responseDueAt: true, firstResponseAt: true, reopenCount: true },
    }),
    db.complaintEvent.findMany({
      where: {
        complaint: { createdAt: created },
        OR: [
          { eventType: "STATUS_CHANGED", payload: { path: ["to"], equals: "PENDING_CONFIRMATION" } },
          { eventType: "COMMENT", payload: { path: ["kind"], equals: "ack" } },
        ],
      },
      select: { complaintId: true, eventType: true, createdAt: true },
    }),
  ]);
  const earliest = (type: "STATUS_CHANGED" | "COMMENT"): Map<string, number> => {
    const first = new Map<string, number>();
    for (const e of events) {
      if (e.eventType !== type) continue;
      const at = e.createdAt.getTime();
      const seen = first.get(e.complaintId);
      if (seen === undefined || at < seen) first.set(e.complaintId, at);
    }
    return first;
  };
  const resolvedAt = earliest("STATUS_CHANGED");
  const acknowledgedAt = earliest("COMMENT");
  return rows.map((r) => ({
    createdAt: r.createdAt.getTime(),
    safetyFlag: r.safetyFlag,
    status: r.status,
    closeKind: r.closeKind,
    responseDueAt: r.responseDueAt?.getTime() ?? null,
    firstResponseAt: r.firstResponseAt?.getTime() ?? null,
    reopenCount: r.reopenCount,
    resolvedAt: resolvedAt.get(r.id) ?? null,
    acknowledgedAt: r.safetyFlag ? (acknowledgedAt.get(r.id) ?? null) : null,
  }));
}
