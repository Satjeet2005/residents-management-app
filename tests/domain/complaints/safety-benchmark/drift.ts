import { describe, expect, it } from "vitest";
import { mergeTallies, summarise, type Tally } from "@/domain/complaints/safety-benchmark/evaluate";
import { existingNegatives } from "@/domain/complaints/safety-benchmark/negatives";
import { GENERATOR_VERSION } from "@/domain/complaints/safety-benchmark/perturb";
import { DOUBLE_PER_SEED, NEGATIVE_SIZES, SETS, SINGLE_PER_SEED, generateSeed, type SetName } from "@/domain/complaints/safety-benchmark/sets";
import { existingDigest, existingTally, pooledSummary, readExpected, readSample, seedDigest, seedTally, setDigestOf } from "./fixtures";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The drift tests of one frozen set: each seed is regenerated and compared with the committed digest, counts, sample and metrics (one test per seed, so each stays well under 3 s). */
export function describeFrozenSet(set: SetName): void {
  const expected = readExpected(set);

  describe(`SB4 the ${set} set is frozen`, () => {
    it("records the generator version, seeds and sizes it was made with", () => {
      expect(expected.generatorVersion).toBe(GENERATOR_VERSION);
      expect(expected.seeds).toEqual(SETS[set]);
      expect(Object.keys(expected.digests)).toEqual(SETS[set].map(String));
      expect(expected.sizes).toEqual({ singlePerSeed: SINGLE_PER_SEED, doublePerSeed: DOUBLE_PER_SEED, negatives: NEGATIVE_SIZES });
    });

    it.each(SETS[set])("seed %i: regenerating gives the committed digest and counts, and the committed sample", (seed) => {
      const g = generateSeed(seed);
      expect(g.single.length).toBe(SINGLE_PER_SEED);
      expect(g.double.length).toBe(DOUBLE_PER_SEED);
      expect({ single: g.single.length, double: g.double.length, negatives: g.negatives.length }).toEqual(expected.counts[seed]);
      expect(seedDigest(g)).toBe(expected.digests[seed]);
      for (const line of readSample(set).filter((l) => l.seed === seed)) expect(g[line.kind][line.index], `${line.kind} ${line.index}`).toMatchObject({ text: line.text, operations: line.operations });
    });

    it.each(SETS[set])("seed %i: the current detector gives the committed metrics", (seed) => {
      expect(json(seedTally(generateSeed(seed)))).toEqual(expected.tallies[seed]);
    });

    it("the existing safety-test negatives are the same and give the committed metrics", () => {
      expect(existingDigest()).toBe(expected.existingNegativesDigest);
      expect(json(existingTally())).toEqual(expected.tallies.existing);
      expect(existingNegatives().length).toBeGreaterThan(0);
    });

    it("the set digest and the pooled numbers follow from the committed parts", () => {
      expect(setDigestOf(expected.digests)).toBe(expected.setDigest);
      expect(json(pooledSummary(expected.tallies))).toEqual(expected.pooled);
      const pooled: Tally = mergeTallies(Object.values(expected.tallies));
      expect(pooled.overall.single.n).toBe(SETS[set].length * SINGLE_PER_SEED);
      expect(pooled.overall.double.n).toBe(SETS[set].length * DOUBLE_PER_SEED);
      expect(json(summarise(pooled))).toEqual(expected.pooled);
    });

    it.each(SETS[set])("seed %i: generation is deterministic, no negative equals a positive, and another seed gives other texts", (seed) => {
      const a = generateSeed(seed);
      const positives = new Set([...a.single, ...a.double].map((i) => i.text));
      for (const n of a.negatives) expect(positives.has(n.text), n.text).toBe(false);
      expect(seedDigest(generateSeed(seed))).toBe(seedDigest(a));
      expect(seedDigest(generateSeed(seed + 1))).not.toBe(seedDigest(a));
    });
  });
}
