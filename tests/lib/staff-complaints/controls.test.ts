import { describe, expect, it } from "vitest";
import type { ComplaintStatus } from "@/domain/complaints/step";
import { type Controls, type ControlViewer, controlsFor } from "@/lib/staff-complaints/controls";

const STATUSES: ComplaintStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "REOPENED", "CLOSED"];
const MANAGER: ControlViewer = { canManage: true, isDutyManager: false };
const DUTY: ControlViewer = { canManage: true, isDutyManager: true };
const NOBODY: ControlViewer = { canManage: false, isDutyManager: false };
const none: Controls = { assign: false, start: false, resolve: false, comment: false, category: false, acknowledge: false, close: false };

/** [status, assign, start, resolve] for an ordinary complaint, from the lifecycle table in docs/complaints-design.md. */
const ORDINARY: [ComplaintStatus, boolean, boolean, boolean][] = [
  ["NEW", true, true, true],
  ["ASSIGNED", true, true, true],
  ["IN_PROGRESS", true, false, true],
  ["PENDING_CONFIRMATION", false, false, false],
  ["REOPENED", true, true, true],
  ["CLOSED", false, false, false],
];

describe("SC8 who sees which control, for an ordinary complaint", () => {
  it.each(ORDINARY)("%s: a manager is offered assign=%s start=%s resolve=%s, comment and category always, and never acknowledge or close", (status, assign, start, resolve) => {
    expect(controlsFor({ status, safety: false, acknowledged: false, viewer: MANAGER })).toEqual({ assign, start, resolve, comment: true, category: true, acknowledge: false, close: false });
  });

  it.each(ORDINARY)("%s: the duty manager sees the same, and still no acknowledge or close on an ordinary complaint", (status, assign, start, resolve) => {
    expect(controlsFor({ status, safety: false, acknowledged: false, viewer: DUTY })).toEqual({ assign, start, resolve, comment: true, category: true, acknowledge: false, close: false });
  });
});

describe("SC9 a safety complaint", () => {
  it.each(STATUSES)("%s: Mark resolved is never offered, to anybody", (status) => {
    for (const viewer of [MANAGER, DUTY]) for (const acknowledged of [false, true]) expect(controlsFor({ status, safety: true, acknowledged, viewer }).resolve).toBe(false);
  });

  it.each(STATUSES)("%s: a plain manager is never offered acknowledge or close", (status) => {
    for (const acknowledged of [false, true]) {
      const controls = controlsFor({ status, safety: true, acknowledged, viewer: MANAGER });
      expect(controls.acknowledge).toBe(false);
      expect(controls.close).toBe(false);
    }
  });

  it.each([
    ["NEW", false, true, true],
    ["ASSIGNED", false, true, true],
    ["IN_PROGRESS", false, true, true],
    ["REOPENED", false, true, true],
    ["PENDING_CONFIRMATION", false, true, false],
    ["CLOSED", false, false, false],
    ["NEW", true, false, true],
    ["ASSIGNED", true, false, true],
    ["CLOSED", true, false, false],
  ] as [ComplaintStatus, boolean, boolean, boolean][])("%s, acknowledged=%s: the duty manager is offered acknowledge=%s close=%s", (status, acknowledged, acknowledge, close) => {
    const controls = controlsFor({ status, safety: true, acknowledged, viewer: DUTY });
    expect(controls.acknowledge).toBe(acknowledge);
    expect(controls.close).toBe(close);
  });

  it("an acknowledged safety complaint offers no second acknowledge", () => {
    expect(controlsFor({ status: "ASSIGNED", safety: true, acknowledged: true, viewer: DUTY }).acknowledge).toBe(false);
  });
});

describe("SC10 nobody without complaints:manage is offered anything", () => {
  it.each(STATUSES)("%s", (status) => {
    for (const safety of [false, true]) expect(controlsFor({ status, safety, acknowledged: false, viewer: NOBODY })).toEqual(none);
    expect(controlsFor({ status, safety: true, acknowledged: false, viewer: { canManage: false, isDutyManager: true } })).toEqual(none);
  });
});
