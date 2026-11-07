import type { ComplaintStatus } from "@/domain/complaints/step";

/** Who is looking: the two permissions that matter on a complaint. The page has already checked `complaints:manage`; the duty manager flag is `complaints:duty_manager`. */
export type ControlViewer = { canManage: boolean; isDutyManager: boolean };

export type ControlsInput = { status: ComplaintStatus; safety: boolean; acknowledged: boolean; viewer: ControlViewer };

/**
 * Which controls the panel offers (D130), from the status, the safety flag, whether the duty manager has already acknowledged, and who is looking. The server
 * decides again and refuses what it must; this is only what the screen offers so that nobody is shown a button that cannot work.
 *
 * - assign: NEW, ASSIGNED, IN_PROGRESS, REOPENED (the lifecycle's ASSIGN). Not while the resident is asked, not when closed.
 * - start ("Mark in progress"): NEW, ASSIGNED, REOPENED (START).
 * - resolve ("Mark resolved"): the same statuses plus IN_PROGRESS, and NEVER for a safety complaint (only the duty manager closes those).
 * - comment and category: always, for anybody who may manage (both are allowed in every status by the service).
 * - acknowledge: ONLY the duty manager, ONLY for a safety complaint that is not closed and not yet acknowledged.
 * - close: ONLY the duty manager, ONLY for a safety complaint in a status the lifecycle lets the duty manager close (CLOSE_SAFETY).
 * Nobody without `complaints:manage` is offered anything.
 */
export type Controls = { assign: boolean; start: boolean; resolve: boolean; comment: boolean; category: boolean; acknowledge: boolean; close: boolean };

const WORKABLE: readonly ComplaintStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "REOPENED"];
const STARTABLE: readonly ComplaintStatus[] = ["NEW", "ASSIGNED", "REOPENED"];

export function controlsFor(input: ControlsInput): Controls {
  const { status, safety, acknowledged, viewer } = input;
  if (!viewer.canManage) return { assign: false, start: false, resolve: false, comment: false, category: false, acknowledge: false, close: false };
  const dutyOnSafety = viewer.isDutyManager && safety;
  return {
    assign: WORKABLE.includes(status),
    start: STARTABLE.includes(status),
    resolve: !safety && WORKABLE.includes(status),
    comment: true,
    category: true,
    acknowledge: dutyOnSafety && status !== "CLOSED" && !acknowledged,
    close: dutyOnSafety && WORKABLE.includes(status),
  };
}
