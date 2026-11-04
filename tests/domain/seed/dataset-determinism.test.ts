import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/domain/seed/generate";
import { DEFAULT_SEED, type DemoDataset } from "@/domain/seed/types";
import { FORCED_CODES, NAMED_FORCED_CODES, defaultDataset, indexOf, serialise } from "./default-dataset";

/** Everything the demo scenarios rely on for the sample flats. */
function forcedFacts(dataset: DemoDataset) {
  return FORCED_CODES.map((code) => {
    const flat = dataset.flats.find((f) => f.code === code);
    if (flat === undefined) throw new Error(`forced flat ${code} is missing`);
    const people = NAMED_FORCED_CODES.includes(code as (typeof NAMED_FORCED_CODES)[number])
      ? dataset.members
          .filter((m) => m.flatKey === flat.key)
          .map((m) => ({ ...m, user: dataset.users.find((u) => u.key === m.userKey) }))
      : [];
    return {
      flat,
      people,
      bills: indexOf(dataset).billsByFlat.get(flat.key) ?? [],
      entries: indexOf(dataset).entriesByFlat.get(flat.key) ?? [],
    };
  });
}

describe("S1 determinism", () => {
  it("S1 the same seed gives an identical dataset (stable serialisation)", () => {
    expect(serialise(generateDemoDataset({ seed: 42 }))).toBe(serialise(generateDemoDataset({ seed: 42 })));
    expect(serialise(generateDemoDataset())).toBe(serialise(defaultDataset()));
    expect(generateDemoDataset().seed).toBe(DEFAULT_SEED);
  });

  it("S1 the same seed gives a deeply equal dataset", () => {
    expect(generateDemoDataset({ seed: 7 })).toEqual(generateDemoDataset({ seed: 7 }));
  });

  it.each([1, 2, 20261028])("S1 seed %i changes the random content", (seed) => {
    const other = generateDemoDataset({ seed });
    expect(serialise(other)).not.toBe(serialise(defaultDataset()));
    expect(other.flats.map((f) => f.areaSqft)).not.toEqual(defaultDataset().flats.map((f) => f.areaSqft));
    expect(other.ledgerEntries.length).not.toBe(defaultDataset().ledgerEntries.length);
  });

  it.each([1, 2, 20261028])("S1 seed %i leaves the forced flats' key facts identical", (seed) => {
    expect(serialise(forcedFacts(generateDemoDataset({ seed })))).toBe(serialise(forcedFacts(defaultDataset())));
  });

  it("S1 every seed still gives 2,400 flats with the same mean area", () => {
    for (const seed of [1, 2, 3]) {
      const flats = generateDemoDataset({ seed }).flats;
      expect(flats).toHaveLength(2400);
      expect(flats.reduce((sum, f) => sum + f.areaSqft, 0) / 2400).toBe(1157.6);
    }
  });
});
