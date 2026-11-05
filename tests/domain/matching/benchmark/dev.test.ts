import { beforeAll, describe, expect, it } from "vitest";
import { defaultBase } from "@/domain/matching/benchmark/simulate";
import type { Base } from "@/domain/matching/benchmark/population";
import { SETS, evaluateFrozen, pool, populationDigest, readExpected, readFrozen, simulate, truthText } from "./sets";

let base: Base;
beforeAll(() => {
  base = defaultBase();
});

const expected = readExpected("dev");

describe("the development set is frozen", () => {
  it("lists the five dev statements, seeds 101 to 105", () => {
    expect(SETS.dev).toEqual([101, 102, 103, 104, 105]);
    expect(Object.keys(expected.statements)).toEqual(SETS.dev.map(String));
  });

  it.each(SETS.dev)("seed %i: regenerating gives the committed CSV and truth byte for byte, and the same population", (seed) => {
    const sim = simulate(seed, base);
    const frozen = readFrozen("dev", seed);
    expect(sim.csvText).toBe(frozen.csvText);
    expect(truthText(sim.truth)).toBe(frozen.truthText);
    expect(populationDigest(sim.flats)).toBe(expected.populationDigests[seed]);
  });

  it.each(SETS.dev)("seed %i: the matcher gives the committed metrics", (seed) => {
    const metrics = evaluateFrozen("dev", seed, simulate(seed, base).flats);
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(expected.statements[seed]);
  });

  it("the pooled numbers are the sum of the statements", () => {
    expect(pool(Object.values(expected.statements))).toEqual(expected.pooled);
  });
});
