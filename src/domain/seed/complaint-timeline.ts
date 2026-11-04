import type {
  ComplaintPlan,
  ComplaintStatus,
  DemoClassification,
  DemoComplaint,
  DemoComplaintEvent,
} from "./complaint-types";
import { SLA_MINUTES } from "./settings";

type Materialised = { complaint: DemoComplaint; events: DemoComplaintEvent[]; classification: DemoClassification };
type Draft = Omit<DemoComplaintEvent, "key" | "complaintKey">;

type Final = Pick<DemoComplaint, "status" | "pendingConfirmationAt" | "closedAt" | "closeKind" | "rating" | "reopenCount">;

/** Where the plan stands at the end: the second trip, if there is one, decides. */
function finalState(plan: ComplaintPlan): Final {
  const { reopen } = plan;
  if (reopen !== null) {
    const base = { reopenCount: 1, rating: null, closedAt: null, closeKind: null };
    if (reopen.closedAt !== null) {
      return { ...base, status: "CLOSED", pendingConfirmationAt: reopen.resolvedAt, closedAt: reopen.closedAt, closeKind: "CONFIRMED", rating: reopen.rating };
    }
    if (reopen.resolvedAt !== null) return { ...base, status: "PENDING_CONFIRMATION", pendingConfirmationAt: reopen.resolvedAt };
    return { ...base, status: "REOPENED", pendingConfirmationAt: null };
  }
  const base = { reopenCount: 0, pendingConfirmationAt: plan.resolvedAt, closedAt: null, closeKind: null, rating: null };
  if (plan.closedAt !== null) return { ...base, status: "CLOSED", closedAt: plan.closedAt, closeKind: plan.closeKind, rating: plan.rating };
  const status: ComplaintStatus =
    plan.resolvedAt !== null ? "PENDING_CONFIRMATION" : plan.firstResponseAt !== null ? "IN_PROGRESS" : plan.assignedAt !== null ? "ASSIGNED" : "NEW";
  return { ...base, status };
}

/** The events of a plan, in the order things happen; ties keep this order. */
function draftEvents(plan: ComplaintPlan, dutyManagerUserKey: string): Draft[] {
  const staff = plan.assigneeUserKey;
  const drafts: Draft[] = [{ type: "CREATED", actorUserKey: plan.raisedByUserKey, payload: {}, createdAt: plan.createdAt }];
  const { classification } = plan;
  const classified = (actorUserKey: string | null): Draft => ({
    type: "CLASSIFIED",
    actorUserKey,
    payload: { source: classification.source, category: plan.categoryCode, urgency: plan.urgency, confidence: classification.confidence },
    createdAt: classification.at,
  });
  if (classification.source !== "MANUAL") drafts.push(classified(null));
  if (plan.escalatedAt !== null) drafts.push({ type: "ESCALATED", actorUserKey: null, payload: { reason: "SAFETY_RULE", to: dutyManagerUserKey }, createdAt: plan.escalatedAt });
  if (plan.assignedAt !== null) drafts.push({ type: "ASSIGNED", actorUserKey: null, payload: { assignee: staff }, createdAt: plan.assignedAt });
  if (classification.source === "MANUAL") {
    drafts.push({ type: "CATEGORY_CORRECTED", actorUserKey: staff, payload: { from: classification.correctedFromCategoryCode, to: plan.categoryCode }, createdAt: classification.at });
    drafts.push(classified(staff));
  }
  const change = (from: string, to: string, at: number): Draft => ({ type: "STATUS_CHANGED", actorUserKey: staff, payload: { from, to }, createdAt: at });
  if (plan.firstResponseAt !== null) drafts.push(change("ASSIGNED", "IN_PROGRESS", plan.firstResponseAt));
  for (const comment of plan.comments) drafts.push({ type: "COMMENT", actorUserKey: staff, payload: { body: comment.body }, createdAt: comment.at });
  if (plan.resolvedAt !== null) drafts.push(change("IN_PROGRESS", "PENDING_CONFIRMATION", plan.resolvedAt));
  const closer = plan.closeKind === "CONFIRMED" ? plan.raisedByUserKey : plan.closeKind === "DUTY_MANAGER" ? dutyManagerUserKey : null;
  if (plan.closedAt !== null) drafts.push({ type: "CLOSED", actorUserKey: closer, payload: { closeKind: plan.closeKind, rating: plan.rating }, createdAt: plan.closedAt });
  for (const extra of plan.extraEvents) drafts.push({ type: extra.type, actorUserKey: null, payload: extra.payload, createdAt: extra.at });
  const { reopen } = plan;
  if (reopen !== null) {
    drafts.push({ type: "REOPENED", actorUserKey: plan.raisedByUserKey, payload: { reopenCount: 1 }, createdAt: reopen.at });
    if (reopen.resolvedAt !== null) drafts.push(change("REOPENED", "PENDING_CONFIRMATION", reopen.resolvedAt));
    if (reopen.closedAt !== null) {
      drafts.push({ type: "CLOSED", actorUserKey: plan.raisedByUserKey, payload: { closeKind: "CONFIRMED", rating: reopen.rating }, createdAt: reopen.closedAt });
    }
  }
  return drafts;
}

/** Turns a plan into the complaint row, its events (oldest first) and its classification. */
export function materialise(plan: ComplaintPlan, dutyManagerUserKey: string): Materialised {
  const key = `complaint:${plan.id}`;
  const final = finalState(plan);
  const complaint: DemoComplaint = {
    key,
    flatKey: plan.flatKey,
    raisedByUserKey: plan.raisedByUserKey,
    body: plan.body,
    categoryCode: plan.categoryCode,
    urgency: plan.urgency,
    safetyFlag: plan.safety,
    assigneeUserKey: plan.assignedAt === null ? null : plan.assigneeUserKey,
    responseDueAt: plan.createdAt + SLA_MINUTES[plan.urgency] * 60_000,
    firstResponseAt: plan.firstResponseAt,
    needsReview: plan.classification.source === "FALLBACK" && final.status !== "CLOSED",
    createdAt: plan.createdAt,
    ...final,
  };
  const events = draftEvents(plan, dutyManagerUserKey)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((draft, index): DemoComplaintEvent => ({ key: `event:${key}:${String(index + 1).padStart(2, "0")}`, complaintKey: key, ...draft }));
  const { source, confidence, at } = plan.classification;
  const classification: DemoClassification = { complaintKey: key, source, categoryCode: plan.categoryCode, urgency: plan.urgency, confidence, createdAt: at };
  return { complaint, events, classification };
}
