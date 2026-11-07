import { nextTabIndex } from "@/lib/reconciliation/lanes";
import { t } from "@/lib/messages";

/** The board's lanes in the order of the tabs. The same six names as `LANES` in `src/server/complaints/board.ts` (a test keeps them equal). */
export const BOARD_LANES = ["NEEDS_TRIAGE", "SAFETY", "OPEN", "OVERDUE", "WAITING_RESIDENT", "CLOSED"] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

const QUERY_OF: Record<BoardLane, string> = {
  NEEDS_TRIAGE: "needs-triage",
  SAFETY: "safety",
  OPEN: "open",
  OVERDUE: "overdue",
  WAITING_RESIDENT: "waiting",
  CLOSED: "closed",
};

/** The lane named by `?lane=`, or null when there is none or it names no lane: the page then chooses (`chooseLane`). */
export function laneFromQuery(value: string | string[] | undefined): BoardLane | null {
  const text = Array.isArray(value) ? value[0] : value;
  return BOARD_LANES.find((lane) => QUERY_OF[lane] === text) ?? null;
}

export const laneQuery = (lane: BoardLane): string => QUERY_OF[lane];

/** The address of the board for a lane. The lane is always in the address: the default depends on who asks, so a plain address would not say what it shows. */
export const boardHref = (lane: BoardLane): string => `/staff/complaints?lane=${QUERY_OF[lane]}`;

/**
 * The lane to show. A lane in the address wins. Without one, the duty manager sees Safety when it has something in it (the first thing they must
 * look at), and everybody else, and a duty manager with no open safety complaint, sees Needs triage.
 */
export function chooseLane(input: { requested: BoardLane | null; isDutyManager: boolean; safetyCount: number }): BoardLane {
  if (input.requested !== null) return input.requested;
  return input.isDutyManager && input.safetyCount > 0 ? "SAFETY" : "NEEDS_TRIAGE";
}

export function laneLabel(lane: BoardLane): string {
  switch (lane) {
    case "NEEDS_TRIAGE":
      return t("staffComplaints.lane.needsTriage");
    case "SAFETY":
      return t("staffComplaints.lane.safety");
    case "OPEN":
      return t("staffComplaints.lane.open");
    case "OVERDUE":
      return t("staffComplaints.lane.overdue");
    case "WAITING_RESIDENT":
      return t("staffComplaints.lane.waiting");
    case "CLOSED":
      return t("staffComplaints.lane.closed");
  }
}

/** What an empty lane says: the same sentence for every lane. */
export const emptyLaneText = (): string => t("staffComplaints.empty");

export { nextTabIndex };
