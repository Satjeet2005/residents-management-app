import { describe, expect, it } from "vitest";
import { laneFromQuery, laneLabel, laneQuery, nextTabIndex, rowFromQuery, workspaceHref } from "@/lib/reconciliation/lanes";
import { LANES } from "@/lib/reconciliation/types";

const IMPORT = "11111111-2222-3333-4444-555555555555";
const ROW = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("RL1 the lane in the URL", () => {
  it("every lane round-trips through its query word, and the words are the tab names in lower case", () => {
    for (const lane of LANES) expect(laneFromQuery(laneQuery(lane))).toBe(lane);
    expect(LANES.map(laneQuery)).toEqual(["needs-you", "awaiting-approval", "posted", "not-maintenance"]);
  });

  it("a missing, unknown or repeated value is the first lane (or the first value)", () => {
    expect(laneFromQuery(undefined)).toBe("NEEDS_YOU");
    expect(laneFromQuery("nonsense")).toBe("NEEDS_YOU");
    expect(laneFromQuery(["posted", "needs-you"])).toBe("MATCHED");
    expect(laneFromQuery("NEEDS_YOU")).toBe("NEEDS_YOU");
  });

  it("the lanes are labelled Needs you, Awaiting approval, Posted and Not maintenance", () => {
    expect(LANES.map(laneLabel)).toEqual(["Needs you", "Awaiting approval", "Posted", "Not maintenance"]);
  });
});

describe("RL2 workspace addresses", () => {
  it("the first lane leaves the query out, another lane and a selected row are written in", () => {
    expect(workspaceHref({ importId: IMPORT, lane: "NEEDS_YOU" })).toBe(`/staff/reconciliation/${IMPORT}`);
    expect(workspaceHref({ importId: IMPORT, lane: "MATCHED" })).toBe(`/staff/reconciliation/${IMPORT}?lane=posted`);
    expect(workspaceHref({ importId: IMPORT, lane: "NEEDS_YOU", row: ROW })).toBe(`/staff/reconciliation/${IMPORT}?row=${ROW}`);
    expect(workspaceHref({ importId: IMPORT, lane: "AWAITING_APPROVAL", row: ROW })).toBe(`/staff/reconciliation/${IMPORT}?lane=awaiting-approval&row=${ROW}`);
    expect(workspaceHref({ importId: IMPORT, lane: "NEEDS_YOU", row: null })).toBe(`/staff/reconciliation/${IMPORT}`);
  });

  it("the selected row is kept only when it looks like an id", () => {
    expect(rowFromQuery(ROW)).toBe(ROW);
    expect(rowFromQuery([ROW, "x"])).toBe(ROW);
    expect(rowFromQuery("../../etc")).toBeNull();
    expect(rowFromQuery("<script>")).toBeNull();
    expect(rowFromQuery(undefined)).toBeNull();
  });
});

describe("RL3 arrow keys on the tabs", () => {
  it.each([
    ["ArrowRight", 0, 1],
    ["ArrowRight", 3, 0],
    ["ArrowLeft", 0, 3],
    ["ArrowLeft", 2, 1],
    ["Home", 2, 0],
    ["End", 0, 3],
  ])("%s from tab %i goes to tab %i", (key, from, to) => {
    expect(nextTabIndex(key, from, 4)).toBe(to);
  });

  it("any other key does nothing", () => {
    expect(nextTabIndex("Enter", 1, 4)).toBeNull();
    expect(nextTabIndex("a", 1, 4)).toBeNull();
  });
});
