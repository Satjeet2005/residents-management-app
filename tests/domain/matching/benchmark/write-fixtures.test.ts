import { describe, it } from "vitest";
import { defaultBase } from "@/domain/matching/benchmark/simulate";
import { SETS, writeFixtures, type SetName } from "./sets";

/**
 * Rewrites the frozen benchmark files of ONE set. It does nothing unless BENCHMARK_WRITE names the set
 * (BENCHMARK_WRITE=dev npx vitest run tests/domain/matching/benchmark/write-fixtures.test.ts). The holdout is written once.
 */
const target = process.env.BENCHMARK_WRITE as SetName | undefined;

describe("write the frozen benchmark files", () => {
  it.skipIf(target === undefined || !(target in SETS))("writes the set named by BENCHMARK_WRITE", () => {
    writeFixtures(target as SetName, defaultBase());
  }, 60_000);
});
