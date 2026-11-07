import { describe, expect, it } from "vitest";
import { BOARD_LANES, boardHref, chooseLane, emptyLaneText, laneFromQuery, laneLabel, laneQuery, nextTabIndex } from "@/lib/staff-complaints/lanes";
import { LANES } from "@/server/complaints/board";

describe("SC1 the board's lanes", () => {
  it("are the six lanes of the service, in the order of the tabs", () => {
    expect([...BOARD_LANES].sort()).toEqual([...LANES].sort());
    expect(BOARD_LANES.map(laneLabel)).toEqual(["Needs triage", "Safety", "Open", "Overdue", "Waiting for resident", "Closed"]);
  });

  it.each(BOARD_LANES)("%s survives the round trip through the address", (lane) => {
    expect(laneFromQuery(laneQuery(lane))).toBe(lane);
    expect(boardHref(lane)).toBe(`/staff/complaints?lane=${laneQuery(lane)}`);
  });

  it.each([undefined, "", "NEEDS_TRIAGE", "needs_triage", "Safety", "all", "<script>", "safety,open"])("an unknown value %j names no lane", (value) => {
    expect(laneFromQuery(value)).toBeNull();
  });

  it("the first of several values counts", () => {
    expect(laneFromQuery(["overdue", "closed"])).toBe("OVERDUE");
    expect(laneFromQuery([])).toBeNull();
  });

  it("the address words are the ones the task names", () => {
    expect(BOARD_LANES.map(laneQuery)).toEqual(["needs-triage", "safety", "open", "overdue", "waiting", "closed"]);
  });
});

describe("SC2 which lane opens first", () => {
  it.each([
    ["a lane in the address wins for a duty manager with safety items", { requested: "OPEN", isDutyManager: true, safetyCount: 3 }, "OPEN"],
    ["a lane in the address wins for a plain manager", { requested: "CLOSED", isDutyManager: false, safetyCount: 0 }, "CLOSED"],
    ["the duty manager with safety items sees Safety", { requested: null, isDutyManager: true, safetyCount: 1 }, "SAFETY"],
    ["the duty manager with no safety items sees Needs triage", { requested: null, isDutyManager: true, safetyCount: 0 }, "NEEDS_TRIAGE"],
    ["a plain manager sees Needs triage even when safety has items", { requested: null, isDutyManager: false, safetyCount: 5 }, "NEEDS_TRIAGE"],
  ] as const)("%s", (_name, input, expected) => {
    expect(chooseLane(input)).toBe(expected);
  });
});

describe("SC3 tabs and words", () => {
  it("arrow keys wrap round, Home and End jump, other keys are ignored", () => {
    expect(nextTabIndex("ArrowRight", 5, 6)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 6)).toBe(5);
    expect(nextTabIndex("Home", 3, 6)).toBe(0);
    expect(nextTabIndex("End", 3, 6)).toBe(5);
    expect(nextTabIndex("a", 3, 6)).toBeNull();
  });

  it("an empty lane says the same sentence everywhere", () => {
    expect(emptyLaneText()).toBe("Nothing here. Every complaint is handled.");
  });
});
