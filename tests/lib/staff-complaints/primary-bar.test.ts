import { describe, expect, it } from "vitest";
import type { ComplaintStatus } from "@/domain/complaints/step";
import { type ControlViewer, controlsFor } from "@/lib/staff-complaints/controls";
import { barControls, barKind, onlyControls, sheetRows } from "@/lib/staff-complaints/primary-bar";

const DUTY: ControlViewer = { canManage: true, isDutyManager: true };
const MANAGER: ControlViewer = { canManage: true, isDutyManager: false };
const NOBODY: ControlViewer = { canManage: false, isDutyManager: false };

describe("D152 the pinned bar by role and state", () => {
  it.each([
    ["the duty manager, an unacknowledged safety complaint", DUTY, "ASSIGNED", true, false, "ACKNOWLEDGE", ["ACKNOWLEDGE:filled", "MORE:outlined"]],
    ["the duty manager, the same complaint in progress", DUTY, "IN_PROGRESS", true, false, "ACKNOWLEDGE", ["ACKNOWLEDGE:filled", "MORE:outlined"]],
    ["the duty manager, an acknowledged safety complaint", DUTY, "ASSIGNED", true, true, "UPDATE", ["UPDATE:outlined"]],
    ["the duty manager, an ordinary complaint", DUTY, "ASSIGNED", false, false, "UPDATE", ["UPDATE:outlined"]],
    ["a plain manager, an unacknowledged safety complaint (never I have seen this)", MANAGER, "ASSIGNED", true, false, "UPDATE", ["UPDATE:outlined"]],
    ["a plain manager, an ordinary complaint", MANAGER, "NEW", false, false, "UPDATE", ["UPDATE:outlined"]],
    ["a plain manager, a complaint waiting for the resident", MANAGER, "PENDING_CONFIRMATION", false, false, "UPDATE", ["UPDATE:outlined"]],
    ["the duty manager, a closed safety complaint", DUTY, "CLOSED", true, false, "NONE", []],
    ["a plain manager, a closed complaint", MANAGER, "CLOSED", false, false, "NONE", []],
    ["a user without complaints:manage, an ordinary complaint", NOBODY, "ASSIGNED", false, false, "NONE", []],
    ["a user without complaints:manage, an unacknowledged safety complaint", NOBODY, "ASSIGNED", true, false, "NONE", []],
  ] as const)("%s", (_name, viewer, status, safety, acknowledged, kind, controls) => {
    expect(barKind({ status, safety, acknowledged, viewer })).toBe(kind);
    expect(barControls(kind).map((c) => `${c.id}:${c.filled ? "filled" : "outlined"}`)).toEqual(controls);
  });

  it("across every viewer, status, safety flag and acknowledgement there is at most one filled control, and it is I have seen this", () => {
    const statuses: ComplaintStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "REOPENED", "CLOSED"];
    for (const viewer of [DUTY, MANAGER, NOBODY]) for (const status of statuses) for (const safety of [false, true]) for (const acknowledged of [false, true]) {
      const filled = barControls(barKind({ status, safety, acknowledged, viewer })).filter((c) => c.filled);
      expect(filled.length).toBeLessThanOrEqual(1);
      expect(filled.every((c) => c.id === "ACKNOWLEDGE")).toBe(true);
      expect(filled.length === 1).toBe(viewer.isDutyManager && viewer.canManage && safety && status !== "CLOSED" && !acknowledged);
    }
  });
});

describe("D152 the actions sheet", () => {
  it("lists only what the controls offer, in order, and never I have seen this", () => {
    expect(sheetRows(controlsFor({ status: "ASSIGNED", safety: false, acknowledged: false, viewer: MANAGER }))).toEqual(["ASSIGN", "START", "RESOLVE", "COMMENT", "CATEGORY"]);
    expect(sheetRows(controlsFor({ status: "IN_PROGRESS", safety: false, acknowledged: false, viewer: MANAGER }))).toEqual(["ASSIGN", "RESOLVE", "COMMENT", "CATEGORY"]);
    expect(sheetRows(controlsFor({ status: "NEW", safety: false, acknowledged: false, viewer: MANAGER }))).toEqual(["ASSIGN", "START", "RESOLVE", "COMMENT", "CATEGORY"]);
    expect(sheetRows(controlsFor({ status: "ASSIGNED", safety: true, acknowledged: false, viewer: DUTY }))).toEqual(["ASSIGN", "START", "COMMENT", "CATEGORY", "CLOSE"]);
    expect(sheetRows(controlsFor({ status: "ASSIGNED", safety: true, acknowledged: false, viewer: MANAGER }))).toEqual(["ASSIGN", "START", "COMMENT", "CATEGORY"]);
    expect(sheetRows(controlsFor({ status: "PENDING_CONFIRMATION", safety: false, acknowledged: false, viewer: MANAGER }))).toEqual(["COMMENT", "CATEGORY"]);
    expect(sheetRows(controlsFor({ status: "ASSIGNED", safety: false, acknowledged: false, viewer: NOBODY }))).toEqual([]);
  });

  it("Mark resolved is never offered for a safety complaint, and Close this safety complaint only to the duty manager", () => {
    for (const viewer of [DUTY, MANAGER]) {
      const rows = sheetRows(controlsFor({ status: "IN_PROGRESS", safety: true, acknowledged: true, viewer }));
      expect(rows).not.toContain("RESOLVE");
      expect(rows.includes("CLOSE")).toBe(viewer.isDutyManager);
    }
  });

  it("each form has only its own control on", () => {
    for (const row of ["ASSIGN", "START", "RESOLVE", "COMMENT", "CATEGORY", "CLOSE"] as const) {
      const on = Object.entries(onlyControls(row)).filter(([, value]) => value).map(([key]) => key);
      expect(on).toHaveLength(1);
      expect(onlyControls(row).acknowledge).toBe(false);
    }
  });
});
