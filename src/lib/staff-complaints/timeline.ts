import type { TimelineEventType } from "@/domain/complaints/timeline";
import { t } from "@/lib/messages";
import { categoryLabel, confidenceWords, sourceName, urgencyLabel } from "./labels";
import { isUrgency } from "@/domain/complaints/taxonomy";

/** One event of a complaint as the detail page reads it: the type, when, who did it (null for the system), and the stored facts. */
export type TimelineInput = { id: string; eventType: TimelineEventType; at: number; actor: { id: string; name: string } | null; payload: unknown };

/** What the staff timeline shows. `visibility` says whether the RESIDENT sees this line (their own timeline is `residentTimeline`) or only staff do. */
export type TimelineLine = {
  key: string;
  at: number;
  /** The person who did it, or null for the system. */
  who: string | null;
  label: string;
  text: string | null;
  visibility: "visible" | "internal";
};

const record = (payload: unknown): Record<string, unknown> => (typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {});
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * The FULL timeline for staff, oldest first, internal events and internal comments included, each marked "visible to the resident" or "internal". The marks follow
 * `residentTimeline` (`src/domain/complaints/timeline.ts`), which a test compares line by line: Raised, Assigned, status changes, the escalation, a comment
 * marked visible, Reopened and Closed are visible; the classification, a category correction, an acknowledgement, an internal comment and every note are
 * internal. A note on a visible event is a line of its own, marked internal, because the resident sees the event and not the note. `names` turns the
 * user ids stored in a payload into names; an id it does not know reads as "someone".
 */
export function staffTimeline(events: readonly TimelineInput[], names: ReadonlyMap<string, string>): TimelineLine[] {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const who = (event: TimelineInput): string | null => event.actor?.name ?? null;
  const nameOf = (id: unknown): string => (typeof id === "string" ? (names.get(id) ?? t("staffComplaints.timeline.someone")) : t("staffComplaints.timeline.someone"));
  const out: TimelineLine[] = [];
  ordered.forEach((event, index) => {
    const payload = record(event.payload);
    const line = (label: string, visibility: TimelineLine["visibility"], text: string | null = null): void => {
      out.push({ key: `${event.id}-${out.length}`, at: event.at, who: who(event), label, text, visibility });
    };
    const note = (label: string, text: string | null): void => {
      if (text !== null) line(label, "internal", text);
    };
    switch (event.eventType) {
      case "CREATED":
        line(payload.declaredDanger === true ? t("staffComplaints.timeline.raisedDanger") : t("staffComplaints.timeline.raised"), "visible");
        if (payload.note === "NO_DESCRIPTION") line(t("staffComplaints.timeline.noDescription"), "internal");
        break;
      case "CLASSIFIED": {
        const source = payload.source === "RULE" || payload.source === "LLM" || payload.source === "FALLBACK" || payload.source === "MANUAL" ? payload.source : null;
        const urgency = isUrgency(payload.urgency) ? urgencyLabel(payload.urgency) : t("staffComplaints.timeline.unknown");
        const confidence = typeof payload.confidence === "number" ? payload.confidence : null;
        line(
          source === null ? t("staffComplaints.timeline.classified") : t("staffComplaints.timeline.classifiedBy", { source: sourceName(source) }),
          "internal",
          t("staffComplaints.timeline.classifiedText", { category: categoryLabel(str(payload.category)), urgency, confidence: confidenceWords(confidence) }),
        );
        break;
      }
      case "ASSIGNED":
        line(t("staffComplaints.timeline.assigned", { name: nameOf(payload.assignee) }), ordered[index - 1]?.eventType === "ESCALATED" ? "internal" : "visible");
        break;
      case "STATUS_CHANGED": {
        const to = payload.to;
        if (to === "IN_PROGRESS") line(t("staffComplaints.timeline.inProgress"), "visible");
        else if (to === "PENDING_CONFIRMATION") line(t("staffComplaints.timeline.resolved"), "visible");
        else if (to === "ASSIGNED") line(t("staffComplaints.timeline.assignedPlain"), "visible");
        else line(t("staffComplaints.timeline.statusChanged"), "internal");
        note(t("staffComplaints.timeline.note"), str(payload.note));
        break;
      }
      case "COMMENT":
        if (payload.kind === "ack") line(t("staffComplaints.timeline.acknowledged"), "internal");
        else if (payload.visibleToResident === true) line(t("staffComplaints.timeline.commentVisible"), "visible", str(payload.body));
        else line(t("staffComplaints.timeline.commentInternal"), "internal", str(payload.body));
        break;
      case "REOPENED":
        line(t("staffComplaints.timeline.reopened"), "visible", str(payload.reason));
        break;
      case "CATEGORY_CORRECTED":
        line(t("staffComplaints.timeline.categoryChanged", { from: categoryLabel(str(payload.from)), to: categoryLabel(str(payload.to)) }), "internal");
        break;
      case "ESCALATED":
        line(
          payload.note === "NO_DUTY_MANAGER" ? t("staffComplaints.timeline.escalatedNobody") : payload.reason === "DECLARED" ? t("staffComplaints.timeline.escalatedDeclared") : t("staffComplaints.timeline.escalatedRule"),
          "visible",
        );
        break;
      case "CLOSED": {
        const kind = payload.closeKind;
        line(kind === "CONFIRMED" ? t("staffComplaints.timeline.closedConfirmed") : kind === "AUTO_CLOSED" ? t("staffComplaints.timeline.closedAuto") : kind === "DUTY_MANAGER" ? t("staffComplaints.timeline.closedDuty") : t("staffComplaints.timeline.closed"), "visible");
        note(t("staffComplaints.timeline.closingNote"), str(payload.note));
        if (typeof payload.rating === "number") line(t("staffComplaints.timeline.rating", { n: payload.rating }), "internal");
        break;
      }
      case "DUPLICATE_LINKED":
        line(t("staffComplaints.timeline.duplicate"), "internal");
        break;
      case "AFFECTED_TOO":
        line(t("staffComplaints.timeline.affectedToo"), "internal");
        break;
    }
  });
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ids a payload names (the assignee of an ASSIGNED event), so the loader can look the names up once. Only a UUID can be looked up: a seed key, a number,
 * null, a very long text or anything else is left out (the line then reads "someone", D166), because the id column is a uuid and any other text would make
 * the database refuse the whole query.
 */
export function userIdsIn(events: readonly TimelineInput[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const payload = record(event.payload);
    if (event.eventType === "ASSIGNED" && typeof payload.assignee === "string" && UUID.test(payload.assignee)) ids.add(payload.assignee);
  }
  return [...ids];
}

/** True when an ASSIGNED event names an assignee that is not a UUID (so the page shows "someone" and a warning is logged once). */
export const hasUnusableAssignee = (events: readonly TimelineInput[]): boolean =>
  events.some((event) => event.eventType === "ASSIGNED" && !(typeof record(event.payload).assignee === "string" && UUID.test(record(event.payload).assignee as string)));
