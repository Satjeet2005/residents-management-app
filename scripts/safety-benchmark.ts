// Safety-detection benchmark (docs/safety-benchmark.md). It measures the detector as it is today; it never changes it.
//   npx tsx scripts/safety-benchmark.ts            recompute every committed set, print the headline numbers, exit 1 if anything differs
//   npx tsx scripts/safety-benchmark.ts --write dev|holdout|holdout2   generate a set and write its fixtures (refuses to overwrite: a holdout is run once)
import { isDeepStrictEqual } from "node:util";
import { mergeTallies, summarise, type Rated, type Tally } from "../src/domain/complaints/safety-benchmark/evaluate";
import { GENERATOR_VERSION } from "../src/domain/complaints/safety-benchmark/perturb";
import { SETS, generateSeed, type SetName } from "../src/domain/complaints/safety-benchmark/sets";
import { existingDigest, existingTally, fixturesExist, pooledSummary, readExpected, seedDigest, seedTally, setDigestOf, writeFixtures } from "../tests/domain/complaints/safety-benchmark/fixtures";

const percent = (r: Rated): string => `${(r.rate * 100).toFixed(2)}% (95% CI ${(r.lo * 100).toFixed(2)} to ${(r.hi * 100).toFixed(2)}, ${r.k}/${r.n})`;

function headline(set: SetName, summary: ReturnType<typeof summarise>): void {
  console.log(`${set}: single-operation recall ${percent(summary.headline.singleOperationRecall)}`);
  console.log(`${set}: double-operation recall ${percent(summary.headline.doubleOperationRecall)}`);
  console.log(`${set}: false-alarm rate ${percent(summary.headline.falseAlarmRate)}`);
}

function check(set: SetName): boolean {
  if (!fixturesExist(set)) {
    console.log(`${set}: not generated yet`);
    return true;
  }
  const expected = readExpected(set);
  const generated = SETS[set].map((seed) => generateSeed(seed));
  const digests = Object.fromEntries(generated.map((g) => [String(g.seed), seedDigest(g)]));
  const tallies: Record<string, Tally> = Object.fromEntries(generated.map((g) => [String(g.seed), seedTally(g)]));
  tallies.existing = existingTally();
  const pooled = pooledSummary(tallies);
  headline(set, pooled);
  const same =
    expected.generatorVersion === GENERATOR_VERSION &&
    isDeepStrictEqual(digests, expected.digests) &&
    setDigestOf(digests) === expected.setDigest &&
    existingDigest() === expected.existingNegativesDigest &&
    isDeepStrictEqual(JSON.parse(JSON.stringify(tallies)), expected.tallies) &&
    isDeepStrictEqual(JSON.parse(JSON.stringify(pooled)), expected.pooled);
  if (!same) console.log(`${set}: DIFFERS from the committed expected.json (the generator, the base phrases or the detector changed)`);
  return same;
}

const args = process.argv.slice(2);
if (args[0] === "--write") {
  const set = args[1] as SetName;
  if (!(set in SETS)) throw new Error("usage: --write dev|holdout|holdout2");
  if (fixturesExist(set)) throw new Error(`${set} fixtures already exist; a set is generated once (delete its folder by hand to regenerate)`);
  const written = writeFixtures(set);
  headline(set, written.pooled);
  console.log(mergeTallies(Object.values(written.tallies)).overall);
} else {
  const results = (Object.keys(SETS) as SetName[]).map(check);
  if (results.includes(false)) process.exit(1);
  console.log("safety benchmark: every committed number matches a fresh computation");
}
