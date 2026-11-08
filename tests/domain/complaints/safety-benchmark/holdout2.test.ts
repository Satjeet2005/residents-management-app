import { expect, it } from "vitest";
import { GENERATOR_VERSION } from "@/domain/complaints/safety-benchmark/perturb";
import { SETS } from "@/domain/complaints/safety-benchmark/sets";
import { describeFrozenSet } from "./drift";
import { readExpected } from "./fixtures";

describeFrozenSet("holdout2");

it("T10c holdout 2 uses the generator version and seeds of the earlier sets, and seeds none of them used", () => {
  expect(GENERATOR_VERSION).toBe("safety-perturb-1");
  expect(readExpected("holdout2").generatorVersion).toBe("safety-perturb-1");
  expect(readExpected("holdout2").generatorVersion).toBe(readExpected("holdout").generatorVersion);
  expect(readExpected("holdout2").generatorVersion).toBe(readExpected("dev").generatorVersion);
  expect(SETS.holdout2).toEqual([9401, 9402, 9403, 9404, 9405]);
  const earlier = new Set<number>([...SETS.dev, ...SETS.holdout]);
  for (const seed of SETS.holdout2) expect(earlier.has(seed)).toBe(false);
});
