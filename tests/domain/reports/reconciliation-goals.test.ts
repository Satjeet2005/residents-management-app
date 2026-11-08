import { describe, expect, it } from "vitest";
import { defaultGoals, evaluateGoals, goalsFromSetting } from "@/domain/reports/goals";
import { INTERVENTIONS, type RowStates, isAccounted, reconciliationLine } from "@/domain/reports/reconciliation";

const none: RowStates = { QUEUED: 0, AUTO_MATCHED: 0, AWAITING_APPROVAL: 0, MANUALLY_MATCHED: 0, IGNORED: 0 };
const T0 = Date.UTC(2026, 9, 20, 6, 30);
const minute = 60_000;

describe("RP5 the reconciliation line, on hand-built counts", () => {
  it("no imports: every count is zero, 'all accounted' is no data (null) and the four intervention rows exist with no median", () => {
    const line = reconciliationLine({ states: none, imports: [], decisions: [] });
    expect(line).toMatchObject({ rowsImported: 0, postedAutomatically: 0, postedByHand: 0, waitingForPerson: 0, waitingForApproval: 0, notMaintenance: 0, imports: 0, notAccounted: 0, allAccounted: null });
    expect(line.interventions).toEqual(INTERVENTIONS.map((type) => ({ type, count: 0, medianMinutes: null })));
  });

  it("the rows by what became of them, and the total", () => {
    const line = reconciliationLine({ states: { QUEUED: 41, AUTO_MATCHED: 25, AWAITING_APPROVAL: 2, MANUALLY_MATCHED: 3, IGNORED: 35 }, imports: [{ rowsRead: 106, stored: 106, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
    expect(line).toMatchObject({ rowsImported: 106, postedAutomatically: 25, postedByHand: 3, waitingForPerson: 41, waitingForApproval: 2, notMaintenance: 35, imports: 1, allAccounted: true });
  });

  it("an import is accounted for when stored + already imported + refused = read", () => {
    expect(isAccounted({ rowsRead: 10, stored: 8, invalidRows: 1, alreadyImported: 1 })).toBe(true);
    expect(isAccounted({ rowsRead: 10, stored: 8, invalidRows: 1, alreadyImported: 0 })).toBe(false);
    expect(isAccounted({ rowsRead: 0, stored: 0, invalidRows: 0, alreadyImported: 0 })).toBe(true);
  });

  it("one import that does not add up makes 'all accounted' false and is counted", () => {
    const line = reconciliationLine({ states: none, imports: [{ rowsRead: 5, stored: 5, invalidRows: 0, alreadyImported: 0 }, { rowsRead: 5, stored: 4, invalidRows: 0, alreadyImported: 0 }], decisions: [] });
    expect(line).toMatchObject({ imports: 2, notAccounted: 1, allAccounted: false });
  });

  it("manual interventions by type: the count and the median whole minutes from import to decision (lower middle for an even count)", () => {
    const d = (decision: "MANUAL" | "APPROVED" | "REJECTED" | "IGNORE", minutes: number) => ({ decision, importedAt: T0, decidedAt: T0 + minutes * minute });
    const line = reconciliationLine({ states: none, imports: [], decisions: [d("MANUAL", 10), d("MANUAL", 50), d("MANUAL", 30), d("MANUAL", 20), d("APPROVED", 5), d("IGNORE", 120), d("IGNORE", 119.9)] });
    expect(line.interventions).toEqual([
      { type: "MANUAL", count: 4, medianMinutes: 20 },
      { type: "APPROVED", count: 1, medianMinutes: 5 },
      { type: "REJECTED", count: 0, medianMinutes: null },
      { type: "IGNORE", count: 2, medianMinutes: 119 },
    ]);
  });

  it("a decision recorded before the import's own time counts as zero minutes, not a negative number", () => {
    const line = reconciliationLine({ states: none, imports: [], decisions: [{ decision: "REJECTED", importedAt: T0, decidedAt: T0 - 5 * minute }] });
    expect(line.interventions.find((i) => i.type === "REJECTED")).toEqual({ type: "REJECTED", count: 1, medianMinutes: 0 });
  });
});

describe("RP1 the goals", () => {
  it("are 90, 90 and 8 by default, labelled as defaults", () => {
    expect(defaultGoals).toEqual({ onTimeCollectionPercent: 90, firstReplyWithinSlaPercent: 90, reopenedPercentMax: 8 });
    expect(goalsFromSetting(undefined)).toEqual({ goals: defaultGoals, source: "DEFAULT" });
  });

  it("come from the setting when it is complete and valid", () => {
    expect(goalsFromSetting({ onTimeCollectionPercent: 85, firstReplyWithinSlaPercent: 95, reopenedPercentMax: 5 })).toEqual({ goals: { onTimeCollectionPercent: 85, firstReplyWithinSlaPercent: 95, reopenedPercentMax: 5 }, source: "SETTING" });
  });

  it.each([null, "x", 5, [], {}, { onTimeCollectionPercent: 90 }, { onTimeCollectionPercent: 101, firstReplyWithinSlaPercent: 90, reopenedPercentMax: 8 }, { onTimeCollectionPercent: "90", firstReplyWithinSlaPercent: 90, reopenedPercentMax: 8 }, { onTimeCollectionPercent: 90, firstReplyWithinSlaPercent: -1, reopenedPercentMax: 8 }, { onTimeCollectionPercent: 90, firstReplyWithinSlaPercent: 90, reopenedPercentMax: Number.NaN }])(
    "an invalid setting %j falls back to the defaults and says so",
    (value) => {
      expect(goalsFromSetting(value)).toEqual({ goals: defaultGoals, source: "DEFAULT" });
    },
  );

  it("each goal is Met, Not met or No data, worked out on the counts", () => {
    const rows = evaluateGoals(defaultGoals, { onTime: { n: 90, d: 100 }, firstReply: { n: 89, d: 100 }, reopened: { n: 8, d: 100 } });
    expect(rows.map((r) => [r.key, r.targetPercent, r.actualPercent, r.status])).toEqual([
      ["onTimeCollection", 90, 90, "MET"],
      ["firstReplyWithinSla", 90, 89, "NOT_MET"],
      ["reopenedMax", 8, 8, "MET"],
    ]);
  });

  it("89.6 percent does not meet a 90 percent target even though it rounds to 90, and 8.1 percent reopened is over a ceiling of 8", () => {
    const rows = evaluateGoals(defaultGoals, { onTime: { n: 448, d: 500 }, firstReply: { n: 1, d: 1 }, reopened: { n: 81, d: 1000 } });
    expect(rows[0]).toMatchObject({ actualPercent: 90, status: "NOT_MET" });
    expect(rows[2]).toMatchObject({ actualPercent: 8, status: "NOT_MET" });
  });

  it("a zero denominator is No data: never 0 percent and never Met", () => {
    const rows = evaluateGoals(defaultGoals, { onTime: { n: 0, d: 0 }, firstReply: { n: 0, d: 0 }, reopened: { n: 0, d: 0 } });
    expect(rows.map((r) => [r.actualPercent, r.status])).toEqual([[null, "NO_DATA"], [null, "NO_DATA"], [null, "NO_DATA"]]);
  });

  it("zero reopened out of some resolved meets the ceiling at 0 percent", () => {
    expect(evaluateGoals(defaultGoals, { onTime: { n: 0, d: 1 }, firstReply: { n: 0, d: 1 }, reopened: { n: 0, d: 20 } })[2]).toMatchObject({ actualPercent: 0, status: "MET" });
  });
});

describe("RP1b the gap to each goal, in whole points (D176)", () => {
  const rows = (onTime: [number, number], reply: [number, number], reopened: [number, number]) =>
    evaluateGoals(defaultGoals, { onTime: { n: onTime[0], d: onTime[1] }, firstReply: { n: reply[0], d: reply[1] }, reopened: { n: reopened[0], d: reopened[1] } });

  it.each([
    ["70 of 100 against 90 is 20 short", [70, 100], "NOT_MET", 20],
    ["93 of 100 against 90 is 3 above", [93, 100], "MET", 3],
    ["exactly 90 is met with a margin of 0", [90, 100], "MET", 0],
    ["89.6 percent is 1 short, never 0 short (a miss rounds up)", [448, 500], "NOT_MET", 1],
    ["93.9 percent is 3 above (a margin rounds down)", [939, 1000], "MET", 3],
  ] as const)("at least 90: %s", (_name, [n, d], status, gap) => {
    expect(rows([n, d], [1, 1], [0, 1])[0]).toMatchObject({ status, gapPoints: gap });
  });

  it.each([
    ["10 of 100 against a ceiling of 8 is 2 over", [10, 100], "NOT_MET", 2],
    ["8.1 percent is 1 over", [81, 1000], "NOT_MET", 1],
    ["5 of 100 is 3 under", [5, 100], "MET", 3],
    ["exactly 8 is met with room 0", [8, 100], "MET", 0],
  ] as const)("at most 8: %s", (_name, [n, d], status, gap) => {
    expect(rows([1, 1], [1, 1], [n, d])[2]).toMatchObject({ status, gapPoints: gap });
  });

  it("with nothing to measure there is no gap", () => {
    expect(rows([0, 0], [0, 0], [0, 0]).map((r) => r.gapPoints)).toEqual([null, null, null]);
  });
});
