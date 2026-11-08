import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectSafetyWords } from "@/domain/complaints/safety";
import { mergeTallies, summarise, tallyNegatives, tallyPositives, type Detect, type Tally } from "@/domain/complaints/safety-benchmark/evaluate";
import { existingNegatives } from "@/domain/complaints/safety-benchmark/negatives";
import { GENERATOR_VERSION } from "@/domain/complaints/safety-benchmark/perturb";
import { DOUBLE_PER_SEED, NEGATIVE_SIZES, SETS, SINGLE_PER_SEED, canonicalSerialisation, generateSeed, type GeneratedSeed, type SetName } from "@/domain/complaints/safety-benchmark/sets";
import { OPERATIONS } from "@/domain/complaints/safety-benchmark/operations";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
export const fixtureDir = (set: SetName): string => path.join(fileURLToPath(new URL("../../../fixtures/safety/", import.meta.url)), set);
const expectedFile = (set: SetName): string => path.join(fixtureDir(set), "expected.json");
const sampleFile = (set: SetName): string => path.join(fixtureDir(set), "sample.jsonl");
export const fixturesExist = (set: SetName): boolean => existsSync(expectedFile(set));

export const seedDigest = (g: GeneratedSeed): string => sha256(canonicalSerialisation(g));
export const existingDigest = (): string => sha256(existingNegatives().map((n) => n.text).join("\n"));

export function seedTally(g: GeneratedSeed, detect: Detect = detectSafetyWords): Tally {
  return mergeTallies([tallyPositives(g.single, "single", detect), tallyPositives(g.double, "double", detect), tallyNegatives(g.negatives, detect)]);
}
export const existingTally = (detect: Detect = detectSafetyWords): Tally => tallyNegatives(existingNegatives(), detect);

export type Expected = {
  set: SetName;
  generatorVersion: string;
  seeds: readonly number[];
  sizes: { singlePerSeed: number; doublePerSeed: number; negatives: typeof NEGATIVE_SIZES };
  digests: Record<string, string>;
  existingNegativesDigest: string;
  setDigest: string;
  counts: Record<string, { single: number; double: number; negatives: number }>;
  tallies: Record<string, Tally>;
  pooled: ReturnType<typeof summarise>;
};

export const pooledSummary = (tallies: Record<string, Tally>) => summarise(mergeTallies(Object.values(tallies)));
export const setDigestOf = (digests: Record<string, string>): string => sha256(Object.keys(digests).map((k) => `${k}:${digests[k]}`).join("\n"));

export function readExpected(set: SetName): Expected {
  return JSON.parse(readFileSync(expectedFile(set), "utf8")) as Expected;
}

/** The sample: the first 100 single-operation items that use each operation, in seed order, one JSON object per line with the place to find it again. */
export function sampleLines(set: SetName, seeds: readonly GeneratedSeed[]): string[] {
  const out: string[] = [];
  for (const operation of OPERATIONS) {
    let taken = 0;
    for (const g of seeds) {
      g.single.forEach((item, index) => {
        if (taken < 100 && item.operations[0] === operation.name) {
          taken += 1;
          out.push(JSON.stringify({ set, seed: g.seed, kind: "single", index, ...item }));
        }
      });
    }
  }
  return out;
}

export const readSample = (set: SetName): { seed: number; kind: "single"; index: number; text: string; operations: string[] }[] =>
  readFileSync(sampleFile(set), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** Generates the set and writes its fixtures. The README is written by hand. Run once per set. */
export function writeFixtures(set: SetName): Expected {
  const generated = SETS[set].map((seed) => generateSeed(seed));
  const digests = Object.fromEntries(generated.map((g) => [String(g.seed), seedDigest(g)]));
  const tallies: Record<string, Tally> = Object.fromEntries(generated.map((g) => [String(g.seed), seedTally(g)]));
  tallies.existing = existingTally();
  const expected: Expected = {
    set,
    generatorVersion: GENERATOR_VERSION,
    seeds: SETS[set],
    sizes: { singlePerSeed: SINGLE_PER_SEED, doublePerSeed: DOUBLE_PER_SEED, negatives: NEGATIVE_SIZES },
    digests,
    existingNegativesDigest: existingDigest(),
    setDigest: setDigestOf(digests),
    counts: Object.fromEntries(generated.map((g) => [String(g.seed), { single: g.single.length, double: g.double.length, negatives: g.negatives.length }])),
    tallies,
    pooled: pooledSummary(tallies),
  };
  mkdirSync(fixtureDir(set), { recursive: true });
  writeFileSync(expectedFile(set), `${JSON.stringify(expected, null, 1)}\n`);
  writeFileSync(sampleFile(set), `${sampleLines(set, generated).join("\n")}\n`);
  return expected;
}
