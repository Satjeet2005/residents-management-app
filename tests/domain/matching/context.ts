import { buildMatchContext, defaultMatchSettings } from "@/domain/matching/context";
import { flatContextsFromDataset } from "@/domain/matching/benchmark/population";
import type { MatchContext, MatchSettings } from "@/domain/matching/types";
import { generateDemoDataset } from "@/domain/seed/generate";
import type { DemoDataset } from "@/domain/seed/types";

/** The test adapter: the demo dataset as the matcher's input. The code lives with the benchmark (src/domain/matching/benchmark/population.ts). */
export { flatContextsFromDataset };

export function demoMatchContext(dataset: DemoDataset, settings: MatchSettings = defaultMatchSettings): MatchContext {
  return buildMatchContext(flatContextsFromDataset(dataset), settings);
}

let cached: DemoDataset | undefined;
/** The default-seed demo dataset, generated once per test file. */
export function demoDataset(): DemoDataset {
  cached ??= generateDemoDataset();
  return cached;
}
