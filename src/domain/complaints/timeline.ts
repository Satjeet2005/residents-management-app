import type { CloseKind } from "./lifecycle";

export type TimelineEventType = "CREATED" | "CLASSIFIED" | "ASSIGNED" | "STATUS_CHANGED" | "COMMENT" | "REOPENED" | "CATEGORY_CORRECTED" | "DUPLICATE_LINKED" | "ESCALATED" | "AFFECTED_TOO" | "CLOSED";
export type EventRow = { eventType: TimelineEventType; createdAt: number; payload: unknown };

export type TimelineKind = "RAISED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "COMMENT" | "REOPENED" | "CLOSED" | "SENT_TO_DUTY_MANAGER";
/** One line of what the resident sees. `label` is the English words (the UI translates by `kind` later); `text` is a staff comment or the resident's own reopen reason. */
export type TimelineEntry = { kind: TimelineKind; label: string; at: number; text: string | null };

const record = (payload: unknown): Record<string, unknown> => (typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {});

const CLOSED_LABEL: Record<CloseKind, string> = {
  CONFIRMED: "Closed. You confirmed it is fixed",
  AUTO_CLOSED: "Closed automatically after no answer",
  DUTY_MANAGER: "Closed by the duty manager",
};
const isCloseKind = (value: unknown): value is CloseKind => value === "CONFIRMED" || value === "AUTO_CLOSED" || value === "DUTY_MANAGER";

/**
 * The timeline a RESIDENT may see, oldest first, built from the events of a complaint: Raised, Assigned, the status changes, staff comments that
 * are marked visible (`visibleToResident: true`: a comment with no mark, an internal note and an acknowledgement are never shown), "Sent to the duty
 * manager" for a safety complaint, Reopened (with the resident's own reason) and Closed. CLASSIFIED, CATEGORY_CORRECTED, links and
 * AFFECTED_TOO are never shown, and nobody's name is. The assignment that follows the escalation of a safety complaint is not shown twice.
 */
export function residentTimeline(events: readonly EventRow[]): TimelineEntry[] {
  const ordered = [...events].sort((a, b) => a.createdAt - b.createdAt);
  const out: TimelineEntry[] = [];
  ordered.forEach((event, index) => {
    const payload = record(event.payload);
    const at = event.createdAt;
    switch (event.eventType) {
      case "CREATED":
        out.push({ kind: "RAISED", label: "Raised", at, text: null });
        break;
      case "ESCALATED":
        out.push({ kind: "SENT_TO_DUTY_MANAGER", label: "Sent to the duty manager", at, text: null });
        break;
      case "ASSIGNED":
        if (ordered[index - 1]?.eventType !== "ESCALATED") out.push({ kind: "ASSIGNED", label: "Assigned", at, text: null });
        break;
      case "STATUS_CHANGED":
        if (payload.to === "IN_PROGRESS") out.push({ kind: "IN_PROGRESS", label: "In progress", at, text: null });
        else if (payload.to === "PENDING_CONFIRMATION") out.push({ kind: "RESOLVED", label: "Marked resolved. Please confirm or reopen", at, text: null });
        else if (payload.to === "ASSIGNED") out.push({ kind: "ASSIGNED", label: "Assigned", at, text: null });
        break;
      case "COMMENT":
        if (payload.visibleToResident === true && typeof payload.body === "string") out.push({ kind: "COMMENT", label: "Update from the society", at, text: payload.body });
        break;
      case "REOPENED":
        out.push({ kind: "REOPENED", label: "Reopened", at, text: typeof payload.reason === "string" ? payload.reason : null });
        break;
      case "CLOSED":
        out.push({ kind: "CLOSED", label: isCloseKind(payload.closeKind) ? CLOSED_LABEL[payload.closeKind] : "Closed", at, text: null });
        break;
      default:
        break;
    }
  });
  return out;
}
