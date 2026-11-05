import { beforeAll, describe, expect, it } from "vitest";
import { defaultBase } from "@/domain/matching/benchmark/simulate";
import type { Base } from "@/domain/matching/benchmark/population";
import { SETS, evaluateFrozen, readExpected, simulate, type SetName } from "./sets";

/**
 * THE GATE. On the development and the holdout set the matcher must post nothing automatically that is not the right flat's
 * right bill (falseAuto is 0, so precision of automatic posts is 1), every statement must be accounted for, and the metrics must equal
 * the committed snapshot, so a change that moves a number is a visible change to a file.
 */
let base: Base;
beforeAll(() => {
  base = defaultBase();
});

const cases = (["dev", "holdout"] as SetName[]).flatMap((set) => SETS[set].map((seed) => [set, seed] as const));

describe("benchmark gate: no false automatic post", () => {
  it.each(cases)("%s seed %i: falseAuto is 0, precision is 1, the statement is accounted, and the numbers equal the snapshot", (set, seed) => {
    const metrics = evaluateFrozen(set, seed, simulate(seed, base).flats);
    expect(metrics.falseAutoRows).toEqual([]);
    expect(metrics.falseAuto).toBe(0);
    expect(metrics.precision).toBe(1);
    expect(metrics.accounted).toBe(true);
    expect(metrics.trueAuto).toBeGreaterThan(0); // a gate that passes because nothing posted proves nothing
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(readExpected(set).statements[seed]);
  });

  it.each(["dev", "holdout"] as SetName[])("%s: the committed snapshot itself says falseAuto 0 on every statement", (set) => {
    const { statements, pooled } = readExpected(set);
    expect(Object.values(statements).map((m) => m.falseAuto)).toEqual([0, 0, 0, 0, 0]);
    expect(pooled.falseAuto).toBe(0);
    expect(pooled.precision).toBe(1);
  });
});
