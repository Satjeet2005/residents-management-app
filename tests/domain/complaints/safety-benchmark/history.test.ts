import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATOR_VERSION } from "@/domain/complaints/safety-benchmark/perturb";
import { readExpected } from "./fixtures";

type Counts = { k: number; n: number };
type Stage = {
  digests: Record<string, string>;
  setDigest: string;
  generatorVersion: string;
  headline: { single: Counts; double: Counts; falseAlarm: Counts };
  byOperation: { single: Record<string, Counts>; double: Record<string, Counts> };
};
const history = JSON.parse(readFileSync("tests/fixtures/safety/history.json", "utf8")) as { sets: Record<"dev" | "holdout" | "holdout2", Stage[]>; everyday: { hits: Record<string, number[]>; hitsThroughABareCurrentRule: number[] } };

describe("T10c H1 before and after: the same generated texts at three detector states", () => {
  it.each(["dev", "holdout", "holdout2"] as const)("%s: the texts, digests and generator version never changed; only the detector did", (set) => {
    const [baseline, afterFix, afterNormalisation] = history.sets[set];
    for (const stage of [baseline, afterFix, afterNormalisation]) {
      expect(stage.generatorVersion).toBe("safety-perturb-1");
      expect(stage.digests).toEqual(baseline.digests);
      expect(stage.setDigest).toBe(baseline.setDigest);
    }
    expect(GENERATOR_VERSION).toBe("safety-perturb-1");
  });

  it.each(["dev", "holdout", "holdout2"] as const)("%s: the last stage is exactly the committed expected.json", (set) => {
    const last = history.sets[set][2];
    const committed = readExpected(set).pooled;
    expect(last.headline.single).toEqual({ k: committed.headline.singleOperationRecall.k, n: committed.headline.singleOperationRecall.n });
    expect(last.headline.double).toEqual({ k: committed.headline.doubleOperationRecall.k, n: committed.headline.doubleOperationRecall.n });
    expect(last.headline.falseAlarm).toEqual({ k: committed.headline.falseAlarmRate.k, n: committed.headline.falseAlarmRate.n });
    for (const [operation, counts] of Object.entries(committed.byOperation.single)) expect(last.byOperation.single[operation]).toEqual({ k: counts.k, n: counts.n });
  });

  it("the measured baseline is the one the T10c task started from (dev 1844/5000, holdout 1799/5000 single-operation)", () => {
    expect(history.sets.dev[0].headline.single).toEqual({ k: 1844, n: 5000 });
    expect(history.sets.holdout[0].headline.single).toEqual({ k: 1799, n: 5000 });
    expect(history.sets.dev[0].headline.falseAlarm).toEqual({ k: 62, n: 1608 });
  });

  it("every operation has the same number of items at every stage", () => {
    for (const set of ["dev", "holdout", "holdout2"] as const) {
      for (const split of ["single", "double"] as const) {
        const [a, b, c] = history.sets[set].map((stage) => Object.fromEntries(Object.entries(stage.byOperation[split]).map(([key, v]) => [key, v.n])));
        expect(b).toEqual(a);
        expect(c).toEqual(a);
      }
    }
  });

  it("Stage 1 never lowers recall on an operation and never adds a false alarm", () => {
    for (const set of ["dev", "holdout", "holdout2"] as const) {
      const [, afterFix, afterNormalisation] = history.sets[set];
      for (const split of ["single", "double"] as const) {
        for (const [operation, counts] of Object.entries(afterNormalisation.byOperation[split])) expect(counts.k, `${set} ${split} ${operation}`).toBeGreaterThanOrEqual(afterFix.byOperation[split][operation].k);
      }
      expect(afterNormalisation.headline.falseAlarm.k).toBeLessThanOrEqual(afterFix.headline.falseAlarm.k);
    }
  });

  it("the everyday group: 88 hits, 71 after the precision fix, 71 after normalisation; 17 through a bare current rule, then 0", () => {
    expect(history.everyday.hits.everyday).toEqual([88, 71, 71]);
    expect(history.everyday.hits.ambiguous).toEqual([9, 9, 9]);
    expect(history.everyday.hitsThroughABareCurrentRule).toEqual([17, 0, 0]);
  });
});
