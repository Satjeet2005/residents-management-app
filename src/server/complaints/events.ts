import type { Prisma } from "../../../generated/prisma/client";
import type { Tx } from "./context";

export type NewEvent = { eventType: Prisma.ComplaintEventCreateManyInput["eventType"]; actorId: string | null; payload: Prisma.InputJsonObject };

/**
 * Appends events to a complaint, each at least one millisecond after the one before, so the timeline order never depends on a tie (the business
 * clock can be frozen for a demo, and one transaction has one `now`).
 */
export async function appendEvents(tx: Tx, complaintId: string, events: readonly NewEvent[], now: number): Promise<void> {
  if (events.length === 0) return;
  const last = await tx.complaintEvent.findFirst({ where: { complaintId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const base = Math.max(now, last === null ? now : last.createdAt.getTime() + 1);
  await tx.complaintEvent.createMany({
    data: events.map((event, index) => ({ complaintId, eventType: event.eventType, actorId: event.actorId, payload: event.payload, createdAt: new Date(base + index) })),
  });
}
