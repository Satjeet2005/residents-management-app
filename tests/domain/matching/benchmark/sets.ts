import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultMatchSettings } from "@/domain/matching/context";
import { parseStatementCsv } from "@/domain/matching/csv";
import { evaluate, type Metrics } from "@/domain/matching/benchmark/evaluate";
import type { Base } from "@/domain/matching/benchmark/population";
import { simulateStatement, type SimulatedStatement } from "@/domain/matching/benchmark/simulate";
import type { TruthRow } from "@/domain/matching/benchmark/truth";
import { processStatement } from "@/domain/matching/processor";
import type { FlatContext } from "@/domain/matching/types";

/** The two benchmark sets. The development set may be used to find bugs; the holdout is run once and never used for tuning. */
export const SETS = {
  dev: [101, 102, 103, 104, 105],
  holdout: [9001, 9002, 9003, 9004, 9005],
} as const;
export type SetName = keyof typeof SETS;
export const ROWS_PER_STATEMENT = 2000;

const FIXTURES = fileURLToPath(new URL("../../../fixtures/benchmark/", import.meta.url));
export const fixtureDir = (set: SetName): string => path.join(FIXTURES, set);
const statementFile = (set: SetName, seed: number, extension: "csv" | "truth.json"): string => path.join(fixtureDir(set), `statement-${seed}.${extension}`);
const expectedFile = (set: SetName): string => path.join(fixtureDir(set), "expected.json");

/** One truth row per line, so a change to one row shows as a one-line diff. */
export const truthText = (truth: readonly TruthRow[]): string => `[\n${truth.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;

/** A hash of everything about the flats that a decision reads, so a silent change to the population is seen. */
export function populationDigest(flats: readonly FlatContext[]): string {
  const text = JSON.stringify(flats, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  return createHash("sha256").update(text).digest("hex");
}

export const simulate = (seed: number, base: Base): SimulatedStatement => simulateStatement({ seed, rows: ROWS_PER_STATEMENT, base });

export function readFrozen(set: SetName, seed: number): { csvText: string; truthText: string } {
  return { csvText: readFileSync(statementFile(set, seed, "csv"), "utf8"), truthText: readFileSync(statementFile(set, seed, "truth.json"), "utf8") };
}

/** Reads the frozen CSV and truth of one statement and scores the processor's decisions against it. */
export function evaluateFrozen(set: SetName, seed: number, flats: readonly FlatContext[]): Metrics {
  const frozen = readFrozen(set, seed);
  const parsed = parseStatementCsv(frozen.csvText);
  const processed = processStatement({ rows: parsed.rows, csvErrors: parsed.errors, flats, settings: defaultMatchSettings, alreadyImportedKeys: new Set() });
  const narrations = new Map(parsed.rows.map((row) => [row.rowNumber, row.narrationRaw]));
  return evaluate(processed, JSON.parse(frozen.truthText) as TruthRow[], narrations);
}

export type Pooled = {
  statements: number;
  rows: number;
  credits: number;
  autoMatched: number;
  trueAuto: number;
  falseAuto: number;
  matchable: number;
  precision: number;
  recall: number;
  autoRate: number;
  wrongIgnores: number;
};

/** All statements of a set as one: the counts are added and the ratios worked out from the sums. */
export function pool(metrics: readonly Metrics[]): Pooled {
  const sum = (pick: (m: Metrics) => number): number => metrics.reduce((total, m) => total + pick(m), 0);
  const trueAuto = sum((m) => m.trueAuto);
  const falseAuto = sum((m) => m.falseAuto);
  const matchable = sum((m) => m.matchable);
  const credits = sum((m) => m.credits);
  return {
    statements: metrics.length,
    rows: sum((m) => m.rows),
    credits,
    autoMatched: sum((m) => m.autoMatched),
    trueAuto,
    falseAuto,
    matchable,
    precision: trueAuto + falseAuto === 0 ? 1 : trueAuto / (trueAuto + falseAuto),
    recall: matchable === 0 ? 1 : trueAuto / matchable,
    autoRate: credits === 0 ? 1 : (trueAuto + falseAuto) / credits,
    wrongIgnores: sum((m) => m.wrongIgnores),
  };
}

export type Expected = {
  set: SetName;
  rowsPerStatement: number;
  populationDigests: Record<string, string>;
  statements: Record<string, Metrics>;
  pooled: Pooled;
};

export const readExpected = (set: SetName): Expected => JSON.parse(readFileSync(expectedFile(set), "utf8")) as Expected;

/** Simulates, scores and writes the frozen files of one set. Only the writer test calls it. */
export function writeFixtures(set: SetName, base: Base): Expected {
  mkdirSync(fixtureDir(set), { recursive: true });
  const expected: Expected = { set, rowsPerStatement: ROWS_PER_STATEMENT, populationDigests: {}, statements: {}, pooled: pool([]) };
  for (const seed of SETS[set]) {
    const sim = simulate(seed, base);
    writeFileSync(statementFile(set, seed, "csv"), sim.csvText);
    writeFileSync(statementFile(set, seed, "truth.json"), truthText(sim.truth));
    expected.populationDigests[seed] = populationDigest(sim.flats);
    expected.statements[seed] = evaluateFrozen(set, seed, sim.flats);
  }
  expected.pooled = pool(Object.values(expected.statements));
  writeFileSync(expectedFile(set), `${JSON.stringify(expected, null, 1)}\n`);
  return expected;
}
