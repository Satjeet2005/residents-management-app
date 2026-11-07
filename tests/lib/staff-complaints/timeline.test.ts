import { describe, expect, it } from "vitest";
import { residentTimeline } from "@/domain/complaints/timeline";
import { type TimelineInput, staffTimeline, userIdsIn } from "@/lib/staff-complaints/timeline";

const T0 = Date.UTC(2026, 10, 6, 6, 30);
const kavita = { id: "u-kavita", name: "Kavita Rao" };
const sanjay = { id: "u-sanjay", name: "Sanjay Pawar" };
const names = new Map([[kavita.id, kavita.name], [sanjay.id, sanjay.name]]);
let n = 0;
const ev = (eventType: TimelineInput["eventType"], minutes: number, payload: unknown, actor: TimelineInput["actor"] = null): TimelineInput => ({ id: `e${(n += 1)}`, eventType, at: T0 + minutes * 60_000, actor, payload });

/** A safety complaint from raise to a duty-manager close, and an ordinary one, each with every kind of event the services write. */
const SAFETY = [
  ev("CREATED", 0, {}, { id: "u-res", name: "Swati Joshi" }),
  ev("CLASSIFIED", 0, { source: "RULE", category: null, urgency: "CRITICAL", confidence: null }),
  ev("ESCALATED", 0, { reason: "SAFETY_RULE", to: sanjay.id }),
  ev("ASSIGNED", 0, { assignee: sanjay.id }),
  ev("COMMENT", 2, { kind: "ack" }, sanjay),
  ev("COMMENT", 3, { body: "Isolating the gas valve", visibleToResident: false }, sanjay),
  ev("COMMENT", 4, { body: "The duty manager is on site", visibleToResident: true }, sanjay),
  ev("CLOSED", 30, { closeKind: "DUTY_MANAGER", note: "Gas isolated and checked", rating: null }, sanjay),
  ev("REOPENED", 40, { reason: "Still a smell", reopenCount: 1 }, { id: "u-res", name: "Swati Joshi" }),
];
const ORDINARY = [
  ev("CREATED", 0, {}),
  ev("CLASSIFIED", 0, { source: "LLM", category: "PLUMBING", urgency: "NORMAL", confidence: 0.91 }),
  ev("ASSIGNED", 0, { assignee: kavita.id }),
  ev("CATEGORY_CORRECTED", 5, { from: "PLUMBING", to: "OTHER" }, kavita),
  ev("ASSIGNED", 6, { assignee: sanjay.id, from: kavita.id }, kavita),
  ev("STATUS_CHANGED", 10, { from: "ASSIGNED", to: "IN_PROGRESS", note: null }, kavita),
  ev("STATUS_CHANGED", 20, { from: "IN_PROGRESS", to: "PENDING_CONFIRMATION", note: "Pipe replaced" }, kavita),
  ev("CLOSED", 30, { closeKind: "CONFIRMED", rating: 5 }),
];

describe("SC11 the staff timeline", () => {
  it("shows every event, internal ones included, oldest first, with who did it", () => {
    const lines = staffTimeline(SAFETY, names);
    expect(lines.map((l) => l.label)).toEqual([
      "Raised",
      "Classified by Rules",
      "Sent to the duty manager: a safety word was found",
      "Assigned to Sanjay Pawar",
      "Seen by the duty manager",
      "Comment, internal",
      "Comment, visible to the resident",
      "Closed by the duty manager",
      "Closing note",
      "Reopened by the resident",
    ]);
    expect(lines.map((l) => l.who)).toEqual(["Swati Joshi", null, null, null, "Sanjay Pawar", "Sanjay Pawar", "Sanjay Pawar", "Sanjay Pawar", "Sanjay Pawar", "Swati Joshi"]);
    expect(lines.find((l) => l.label === "Comment, internal")?.text).toBe("Isolating the gas valve");
    expect(lines.find((l) => l.label === "Closing note")?.text).toBe("Gas isolated and checked");
    expect(lines.find((l) => l.label === "Reopened by the resident")?.text).toBe("Still a smell");
  });

  it("marks what the resident sees as visible and the rest as internal", () => {
    const marks = Object.fromEntries(staffTimeline(SAFETY, names).map((l) => [l.label, l.visibility]));
    expect(marks).toMatchObject({
      Raised: "visible",
      "Classified by Rules": "internal",
      "Sent to the duty manager: a safety word was found": "visible",
      "Assigned to Sanjay Pawar": "internal",
      "Seen by the duty manager": "internal",
      "Comment, internal": "internal",
      "Comment, visible to the resident": "visible",
      "Closed by the duty manager": "visible",
      "Closing note": "internal",
      "Reopened by the resident": "visible",
    });
  });

  it.each([
    ["a safety complaint", SAFETY],
    ["an ordinary complaint", ORDINARY],
  ])("the visible lines of %s are exactly the resident's own timeline, line by line", (_name, events) => {
    const visible = staffTimeline(events, names).filter((l) => l.visibility === "visible");
    const theirs = residentTimeline(events.map((e) => ({ eventType: e.eventType, createdAt: e.at, payload: e.payload })));
    expect(visible).toHaveLength(theirs.length);
    expect(visible.map((l) => l.at)).toEqual(theirs.map((l) => l.at));
    const visibleComments = visible.filter((l) => l.label === "Comment, visible to the resident").map((l) => l.text);
    expect(visibleComments).toEqual(theirs.filter((l) => l.kind === "COMMENT").map((l) => l.text));
  });

  it("an ordinary complaint: the classification, the category correction, a note and the rating are internal; the status changes are visible", () => {
    const lines = staffTimeline(ORDINARY, names);
    expect(lines.map((l) => `${l.visibility}: ${l.label}`)).toEqual([
      "visible: Raised",
      "internal: Classified by Model",
      "visible: Assigned to Kavita Rao",
      "internal: Category changed from Plumbing to Other",
      "visible: Assigned to Sanjay Pawar",
      "visible: Marked in progress",
      "visible: Marked resolved, waiting for the resident",
      "internal: Note",
      "visible: Closed: the resident confirmed it is fixed",
      "internal: The resident rated it 5 out of 5",
    ]);
    expect(lines[1].text).toBe("Plumbing, Normal, High confidence");
    expect(lines[7].text).toBe("Pipe replaced");
  });

  it("a declared danger with no description says so, and a safety complaint with no duty manager says so", () => {
    const lines = staffTimeline([ev("CREATED", 0, { declaredDanger: true, note: "NO_DESCRIPTION" }), ev("ESCALATED", 0, { reason: "DECLARED", to: null, note: "NO_DUTY_MANAGER" })], names);
    expect(lines.map((l) => l.label)).toEqual(["Raised, with a danger report", "The resident wrote no description.", "Safety complaint raised, but nobody is set as the duty manager"]);
    expect(lines.map((l) => l.visibility)).toEqual(["visible", "internal", "visible"]);
    expect(staffTimeline([ev("ESCALATED", 0, { reason: "DECLARED", to: sanjay.id })], names)[0].label).toBe("Sent to the duty manager: the resident said someone is in danger");
  });

  it("an id it does not know reads as 'someone', and events out of order are sorted", () => {
    const lines = staffTimeline([ev("ASSIGNED", 9, { assignee: "u-unknown" }), ev("CREATED", 0, {})], names);
    expect(lines.map((l) => l.label)).toEqual(["Raised", "Assigned to someone"]);
  });

  it("a payload that is not an object never breaks a line", () => {
    for (const payload of [null, "x", 7, [], undefined]) {
      for (const type of ["CREATED", "CLASSIFIED", "ASSIGNED", "STATUS_CHANGED", "COMMENT", "REOPENED", "CATEGORY_CORRECTED", "DUPLICATE_LINKED", "ESCALATED", "AFFECTED_TOO", "CLOSED"] as const) {
        expect(() => staffTimeline([ev(type, 0, payload)], names), `${type} ${String(payload)}`).not.toThrow();
      }
    }
  });

  it("finds the user ids a payload names", () => {
    expect(userIdsIn(ORDINARY).sort()).toEqual([kavita.id, sanjay.id].sort());
    expect(userIdsIn([ev("COMMENT", 0, { assignee: "x" })])).toEqual([]);
  });
});
