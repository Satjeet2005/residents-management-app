import { slaOutcome } from "./sla";
import type { ComplaintStatus } from "./step";
import type { Urgency } from "./taxonomy";

export type CloseKind = "CONFIRMED" | "AUTO_CLOSED" | "DUTY_MANAGER";

/** The columns of a complaint that the lifecycle changes. Times are milliseconds since the epoch. */
export type LifecycleFields = {
  status: ComplaintStatus;
  closedAt: number | null;
  closeKind: CloseKind | null;
  pendingConfirmationAt: number | null;
  reopenCount: number;
  rating: number | null;
  firstResponseAt: number | null;
};

/** What the lifecycle reads: the fields above and the safety flag, which only the safety rules ever set. */
export type LifecycleState = LifecycleFields & { safetyFlag: boolean };

export type LifecycleSettings = { autoCloseDays: number; reopenWindowDays: number };
/** `auto_close_days` is the society setting (D15); the reopen window is 7 days (assumption A2 of docs/complaints-design.md). */
export const defaultLifecycleSettings: LifecycleSettings = { autoCloseDays: 7, reopenWindowDays: 7 };

/**
 * Every change a person or the system can ask for. `MARK_RESOLVED` is the staff "mark resolved" and `RESPOND` is a staff comment or an acknowledgement:
 * it changes nothing but `firstResponseAt`.
 */
export type LifecycleAction =
  | { kind: "ASSIGN" }
  | { kind: "START" }
  | { kind: "MARK_RESOLVED" }
  | { kind: "RESPOND" }
  | { kind: "CONFIRM"; rating?: number }
  | { kind: "REOPEN"; reason: string }
  | { kind: "AUTO_CLOSE" }
  | { kind: "CLOSE_SAFETY" };

export type Refusal = "INVALID_TRANSITION" | "VALIDATION";
export type TransitionResult = { ok: true; fields: LifecycleFields } | { ok: false; refusal: Refusal };

/** The status a staff or resident action may lead to, from each status. CLOSED -> REOPENED has the extra rules in `applyTransition`. */
export const TRANSITIONS: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  NEW: ["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"],
  ASSIGNED: ["IN_PROGRESS", "PENDING_CONFIRMATION"],
  IN_PROGRESS: ["PENDING_CONFIRMATION"],
  PENDING_CONFIRMATION: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION"],
};

/** A safety complaint is never closed by `closeSafety` from these: it is already answered for the resident, or already closed. */
const CLOSABLE_BY_DUTY_MANAGER: readonly ComplaintStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "REOPENED"];

export const REASON_MIN = 5;
export const REASON_MAX = 500;
const DAY_MS = 86_400_000;

const refuse = (refusal: Refusal): TransitionResult => ({ ok: false, refusal });
const allowed = (from: ComplaintStatus, to: ComplaintStatus): boolean => TRANSITIONS[from].includes(to);

/** A reopen reason: 5 to 500 characters after trimming (counted as characters, not UTF-16 units). */
export function isValidReason(reason: unknown): reason is string {
  if (typeof reason !== "string") return false;
  const length = Array.from(reason.trim()).length;
  return length >= REASON_MIN && length <= REASON_MAX;
}

/**
 * The new row fields after one action, or a refusal. Pure and deterministic. The result always satisfies the database checks K1 to K4
 * (docs/complaints-design.md): CLOSED has closed_at and close_kind and nothing else has them; PENDING_CONFIRMATION has its time; a rating exists
 * only on a CONFIRMED close; a safety complaint is closed only by CLOSE_SAFETY, with DUTY_MANAGER, and never by CONFIRM or AUTO_CLOSE.
 *
 * - ASSIGN: NEW or REOPENED become ASSIGNED; an ASSIGNED or IN_PROGRESS complaint keeps its status (a new assignee).
 * - START: NEW, ASSIGNED or REOPENED become IN_PROGRESS.
 * - MARK_RESOLVED: to PENDING_CONFIRMATION; never for a safety complaint.
 * - CONFIRM: PENDING_CONFIRMATION to CLOSED, CONFIRMED, with an optional whole rating 1 to 5.
 * - REOPEN: PENDING_CONFIRMATION, or CLOSED within `reopenWindowDays` of closed_at (safety closures included: the resident may dispute),
 *   to REOPENED with a reason; the closure fields are cleared and reopen_count goes up by one.
 * - AUTO_CLOSE: PENDING_CONFIRMATION for at least `autoCloseDays` days to CLOSED, AUTO_CLOSED; never for a safety complaint.
 * - CLOSE_SAFETY: only for a safety complaint, to CLOSED, DUTY_MANAGER.
 * `firstResponseAt` is set by the first ASSIGN, START, MARK_RESOLVED, CLOSE_SAFETY or RESPOND if it is still empty; a resident's action or the
 * automatic close never sets it.
 */
export function applyTransition(state: LifecycleState, action: LifecycleAction, now: number, settings: LifecycleSettings = defaultLifecycleSettings): TransitionResult {
  const unchanged: LifecycleFields = {
    status: state.status,
    closedAt: state.closedAt,
    closeKind: state.closeKind,
    pendingConfirmationAt: state.pendingConfirmationAt,
    reopenCount: state.reopenCount,
    rating: state.rating,
    firstResponseAt: state.firstResponseAt,
  };
  const staff = (fields: Partial<LifecycleFields>): TransitionResult => ({ ok: true, fields: { ...unchanged, ...fields, firstResponseAt: state.firstResponseAt ?? now } });
  const { status } = state;

  switch (action.kind) {
    case "ASSIGN":
      if (status === "NEW" || status === "REOPENED") return staff({ status: "ASSIGNED" });
      return status === "ASSIGNED" || status === "IN_PROGRESS" ? staff({}) : refuse("INVALID_TRANSITION");
    case "START":
      return allowed(status, "IN_PROGRESS") ? staff({ status: "IN_PROGRESS" }) : refuse("INVALID_TRANSITION");
    case "MARK_RESOLVED":
      if (state.safetyFlag || !allowed(status, "PENDING_CONFIRMATION")) return refuse("INVALID_TRANSITION");
      return staff({ status: "PENDING_CONFIRMATION", pendingConfirmationAt: now });
    case "RESPOND":
      return staff({});
    case "CLOSE_SAFETY":
      if (!state.safetyFlag || !CLOSABLE_BY_DUTY_MANAGER.includes(status)) return refuse("INVALID_TRANSITION");
      return staff({ status: "CLOSED", closedAt: now, closeKind: "DUTY_MANAGER", pendingConfirmationAt: null });
    case "CONFIRM": {
      if (state.safetyFlag || status !== "PENDING_CONFIRMATION") return refuse("INVALID_TRANSITION");
      if (action.rating !== undefined && (!Number.isInteger(action.rating) || action.rating < 1 || action.rating > 5)) return refuse("VALIDATION");
      return { ok: true, fields: { ...unchanged, status: "CLOSED", closedAt: now, closeKind: "CONFIRMED", rating: action.rating ?? null } };
    }
    case "AUTO_CLOSE": {
      if (state.safetyFlag || status !== "PENDING_CONFIRMATION" || state.pendingConfirmationAt === null) return refuse("INVALID_TRANSITION");
      if (now < state.pendingConfirmationAt + settings.autoCloseDays * DAY_MS) return refuse("INVALID_TRANSITION");
      return { ok: true, fields: { ...unchanged, status: "CLOSED", closedAt: now, closeKind: "AUTO_CLOSED", rating: null } };
    }
    case "REOPEN": {
      if (!isValidReason(action.reason)) return refuse("VALIDATION");
      if (!allowed(status, "REOPENED")) return refuse("INVALID_TRANSITION");
      if (status === "CLOSED" && (state.closedAt === null || now > state.closedAt + settings.reopenWindowDays * DAY_MS)) return refuse("INVALID_TRANSITION");
      return {
        ok: true,
        fields: { ...unchanged, status: "REOPENED", closedAt: null, closeKind: null, pendingConfirmationAt: null, rating: null, reopenCount: state.reopenCount + 1 },
      };
    }
  }
}

/** Minutes from creation to the due time of the first response, by urgency (the `sla_minutes` setting; D118 docs). */
export type SlaMinutes = Readonly<Record<Urgency, number>>;
export const defaultSlaMinutes: SlaMinutes = { CRITICAL: 15, HIGH: 120, NORMAL: 1440, LOW: 4320 };

/** When the first response is due: the creation time plus the minutes of the urgency. */
export const responseDueAt = (createdAt: number, urgency: Urgency, sla: SlaMinutes = defaultSlaMinutes): number => createdAt + sla[urgency] * 60_000;

export type SlaState = "MET" | "LATE" | "ON_TIME" | "OVERDUE" | "NONE";

/**
 * The reply clock of a complaint, from `slaOutcome` (D150). MET: replied by the due time. LATE: replied after it (never MET). OVERDUE: no reply and the due
 * time has passed. ON_TIME: no reply and the due time is ahead. NONE: no due time or the complaint is closed.
 */
export function slaState(input: { status: ComplaintStatus; responseDueAt: number | null; firstResponseAt: number | null; now: number }): SlaState {
  if (input.status === "CLOSED" || input.responseDueAt === null) return "NONE";
  switch (slaOutcome(input)) {
    case "MET":
      return "MET";
    case "MISSED_LATE":
      return "LATE";
    case "MISSED_OPEN":
      return "OVERDUE";
    case "NOT_DUE":
      return "ON_TIME";
  }
}
