import type { ReportComplaint } from "@/domain/reports/complaints";
import { type CalendarDate, dayStartInstant } from "@/domain/time/calendar";
import type { Db } from "@/server/auth/db";

/**
 * The complaints raised from the start of `from` to the start of `until` (by created_at, India time; `until` is not included) with the two times the report
 * needs from their events: the first time each was marked resolved and the first acknowledgement by the duty manager. TWO queries however many complaints
 * there are: the complaints, and one query for those events (the relation filter keeps it to the window). The report asks once for a window that covers its
 * month, the previous month and the eight weeks of the SLA chart, and cuts it in memory. Reads only (the app role has SELECT on both tables).
 */
export async function loadComplaintsBetween(db: Db, from: CalendarDate, until: CalendarDate): Promise<ReportComplaint[]> {
  const created = { gte: new Date(dayStartInstant(from)), lt: new Date(dayStartInstant(until)) };
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
