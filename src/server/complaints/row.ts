import type { LifecycleFields, LifecycleState } from "@/domain/complaints/lifecycle";
import type { Urgency } from "@/domain/complaints/taxonomy";
import type { Tx } from "./context";

/** A complaint row, read under its lock, in the shapes the domain uses (times as milliseconds). */
export type LockedComplaint = LifecycleState & {
  id: string;
  flatId: string;
  raisedById: string;
  urgency: Urgency;
  categoryId: string | null;
  assigneeId: string | null;
  responseDueAt: number | null;
  needsReview: boolean;
  version: number;
  createdAt: number;
};

/**
 * Takes the row's lock (`SELECT ... FOR UPDATE`) and reads it, so two people on one complaint take turns and the second sees what the first did.
 * With `flatId` the complaint must belong to that flat, else it is null (a foreign id looks exactly like a missing one).
 */
export async function lockComplaint(tx: Tx, id: string, scope: { flatId?: string } = {}): Promise<LockedComplaint | null> {
  const found =
    scope.flatId === undefined
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM complaints WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM complaints WHERE id = ${id}::uuid AND flat_id = ${scope.flatId}::uuid FOR UPDATE`;
  if (found.length === 0) return null;
  const row = await tx.complaint.findUniqueOrThrow({ where: { id } });
  return {
    id: row.id,
    flatId: row.flatId,
    raisedById: row.raisedById,
    status: row.status,
    safetyFlag: row.safetyFlag,
    urgency: row.urgency,
    categoryId: row.categoryId,
    assigneeId: row.assigneeId,
    closedAt: row.closedAt?.getTime() ?? null,
    closeKind: row.closeKind,
    pendingConfirmationAt: row.pendingConfirmationAt?.getTime() ?? null,
    reopenCount: row.reopenCount,
    rating: row.rating,
    firstResponseAt: row.firstResponseAt?.getTime() ?? null,
    responseDueAt: row.responseDueAt?.getTime() ?? null,
    needsReview: row.needsReview,
    version: row.version,
    createdAt: row.createdAt.getTime(),
  };
}

const date = (ms: number | null): Date | null => (ms === null ? null : new Date(ms));

/** Writes the lifecycle fields of a transition (and any extra columns) and raises the version by one. Only columns the app role may update are named. */
export async function writeLifecycle(tx: Tx, id: string, fields: LifecycleFields, extra: { assigneeId?: string | null; categoryId?: string | null; needsReview?: boolean } = {}): Promise<number> {
  const updated = await tx.complaint.update({
    where: { id },
    data: {
      status: fields.status,
      closedAt: date(fields.closedAt),
      closeKind: fields.closeKind,
      pendingConfirmationAt: date(fields.pendingConfirmationAt),
      reopenCount: fields.reopenCount,
      rating: fields.rating,
      firstResponseAt: date(fields.firstResponseAt),
      ...extra,
      version: { increment: 1 },
    },
    select: { version: true },
  });
  return updated.version;
}
