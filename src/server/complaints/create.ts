import type { Decision } from "@/domain/complaints/decision";
import { NO_DESCRIPTION, isBlankBody, prepareComplaintBody, repeatKey, scriptLabel } from "@/domain/complaints/body";
import { responseDueAt } from "@/domain/complaints/lifecycle";
import type { ComplaintStatus } from "@/domain/complaints/step";
import type { Urgency } from "@/domain/complaints/taxonomy";
import type { Db } from "@/server/auth/db";
import { TRANSACTION_RETRY, withDeadlockRetry } from "@/server/db-retry";
import type { Classifier } from "./classifier";
import { classifyComplaint } from "./classify";
import { type Actor, type Tx, currentFlat, isResident, loadComplaintSettings } from "./context";
import { type ComplaintFailure, failure } from "./errors";
import { type NewEvent, appendEvents } from "./events";
import { outputHash } from "./output-hash";
import { findAssignableDefault, findDutyManager } from "./staff";

/** What a resident gets back after raising a complaint. No assignee id and no staff detail. */
export type RaisedComplaint = {
  id: string;
  status: ComplaintStatus;
  urgency: Urgency;
  category: string | null;
  safetyFlag: boolean;
  needsReview: boolean;
  assigned: boolean;
  responseDueAt: number | null;
};
export type CreateResult = { status: "OK"; complaint: RaisedComplaint; duplicate: boolean } | ComplaintFailure;

/** A repeat of the same text by the same person within this many milliseconds is the same complaint. */
export const REPEAT_WINDOW_MS = 60_000;

const SUMMARY = { id: true, status: true, urgency: true, safetyFlag: true, needsReview: true, assigneeId: true, responseDueAt: true, body: true, category: { select: { code: true } } } as const;
type SummaryRow = { id: string; status: ComplaintStatus; urgency: Urgency; safetyFlag: boolean; needsReview: boolean; assigneeId: string | null; responseDueAt: Date | null; body: string; category: { code: string } | null };
const toRaised = (row: SummaryRow): RaisedComplaint => ({
  id: row.id,
  status: row.status,
  urgency: row.urgency,
  category: row.category?.code ?? null,
  safetyFlag: row.safetyFlag,
  needsReview: row.needsReview,
  assigned: row.assigneeId !== null,
  responseDueAt: row.responseDueAt?.getTime() ?? null,
});

/** The person's own complaint of the last 60 seconds with the same text, if any. The clock is the caller's `now`, as everywhere else. */
async function findRepeat(db: Db | Tx, userId: string, key: string, now: number, declaredDanger: boolean): Promise<SummaryRow | null> {
  const recent = await db.complaint.findMany({ where: { raisedById: userId, createdAt: { gte: new Date(now - REPEAT_WINDOW_MS) } }, select: SUMMARY });
  // A declared danger is never swallowed by an earlier copy of the same text that took the normal path.
  return recent.find((row) => repeatKey(row.body) === key && (!declaredDanger || row.safetyFlag)) ?? null;
}

/** The decision's source as a classifications row: "NONE" (nothing could classify it) is recorded as FALLBACK with no category (the fallback found nothing). */
const rowSource = (decision: Decision): "RULE" | "LLM" | "FALLBACK" => (decision.source === "NONE" ? "FALLBACK" : decision.source);

/**
 * A resident raises a complaint (D9, D73, D118, D119). Order of work:
 *  1. permission (RESIDENT), the text (1 to 2,000 characters after trimming, control characters removed, the words kept as written) and the flat
 *     (the Home's rule; none is NO_FLAT);
 *  2. a repeat of the same text by the same person within 60 seconds returns the existing complaint;
 *  3. classification (src/server/complaints/classify.ts), OUTSIDE the transaction so a slow classifier never holds a connection;
 *  4. ONE transaction, under an advisory lock for (person, text): the repeat is checked again, then the complaint, its classification row, its events
 *     and, for a safety complaint, the notification are written together or not at all.
 * A safety hit is CRITICAL, assigned at once to the duty manager (the smallest name among those who hold the permission; none leaves it NEW with an
 * ESCALATED event that says so). A known category goes to the category's default assignee; no category means needs_review, no assignee, NEW.
 */
export async function createComplaint(input: { db: Db; user: Actor; body: unknown; now: number; classifier: Classifier; budgetMs?: number; clock?: () => number; declaredDanger?: boolean }): Promise<CreateResult> {
  const { db, user, now } = input;
  if (!isResident(user)) return failure("FORBIDDEN");
  const declaredDanger = input.declaredDanger === true;
  const written = prepareComplaintBody(input.body);
  const noDescription = written === null && declaredDanger && isBlankBody(input.body);
  const body = noDescription ? NO_DESCRIPTION : written;
  if (body === null) return failure("VALIDATION");
  const flat = await currentFlat(db, user.id, now);
  if (flat === null) return failure("NO_FLAT");

  const key = repeatKey(body);
  const earlier = await findRepeat(db, user.id, key, now, declaredDanger);
  if (earlier !== null) return { status: "OK", complaint: toRaised(earlier), duplicate: true };

  const members = await db.flatMember.findMany({ where: { flatId: flat.flatId }, select: { user: { select: { name: true } } } });
  const { decision, latencyMs } = await classifyComplaint({ rawText: body, knownNames: [user.name, ...members.map((m) => m.user.name)], classifier: input.classifier, budgetMs: input.budgetMs, clock: input.clock, declaredDanger });

  return withDeadlockRetry(
    () =>
      db.$transaction(
        async (tx): Promise<CreateResult> => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`complaint-create:${user.id}:${key}`}))`;
          const again = await findRepeat(tx, user.id, key, now, declaredDanger);
          if (again !== null) return { status: "OK", complaint: toRaised(again), duplicate: true };

          const settings = await loadComplaintSettings(tx);
          const category = decision.category === null ? null : await tx.complaintCategory.findUnique({ where: { code: decision.category }, select: { id: true, code: true, defaultAssigneeId: true } });
          const dutyManager = decision.safetyFlag ? await findDutyManager(tx) : null;
          const assigneeId = decision.safetyFlag ? (dutyManager?.id ?? null) : category === null ? null : await findAssignableDefault(tx, category.defaultAssigneeId);
          const status: ComplaintStatus = assigneeId === null ? "NEW" : "ASSIGNED";

          const created = await tx.complaint.create({
            data: {
              flatId: flat.flatId,
              raisedById: user.id,
              body,
              language: scriptLabel(body),
              categoryId: category?.id ?? null,
              urgency: decision.urgency,
              safetyFlag: decision.safetyFlag,
              status,
              assigneeId,
              responseDueAt: new Date(responseDueAt(now, decision.urgency, settings.slaMinutes)),
              needsReview: category === null,
              createdAt: new Date(now),
            },
            select: SUMMARY,
          });
          await tx.classification.create({
            data: {
              complaintId: created.id,
              source: rowSource(decision),
              categoryId: category?.id ?? null,
              urgency: decision.urgency,
              confidence: decision.confidence === null ? null : Math.round(decision.confidence * 1000) / 1000,
              latencyMs,
              outputHash: outputHash(decision),
              createdAt: new Date(now),
            },
          });

          const events: NewEvent[] = [
            { eventType: "CREATED", actorId: user.id, payload: declaredDanger ? { declaredDanger: true, ...(noDescription ? { note: "NO_DESCRIPTION" } : {}) } : {} },
            { eventType: "CLASSIFIED", actorId: null, payload: { source: rowSource(decision), category: category?.code ?? null, urgency: decision.urgency, confidence: decision.confidence, reasons: decision.reasons } },
          ];
          if (decision.safetyFlag) {
            const reason = decision.safetyHits.length > 0 ? "SAFETY_RULE" : "DECLARED";
            events.push({ eventType: "ESCALATED", actorId: null, payload: dutyManager === null ? { reason, to: null, note: "NO_DUTY_MANAGER" } : { reason, to: dutyManager.id } });
          }
          if (assigneeId !== null) events.push({ eventType: "ASSIGNED", actorId: null, payload: { assignee: assigneeId } });
          await appendEvents(tx, created.id, events, now);

          if (dutyManager !== null) {
            await tx.notification.create({
              data: {
                recipientId: dutyManager.id,
                kind: "SAFETY_ALERT",
                body: { complaintId: created.id, text: "A safety complaint needs the duty manager now." },
                idempotencyKey: `safety-alert:${created.id}`,
                createdAt: new Date(now),
              },
            });
          }
          return { status: "OK", complaint: toRaised(created), duplicate: false };
        },
        { timeout: 30_000, maxWait: 10_000 },
      ),
    TRANSACTION_RETRY,
  );
}
