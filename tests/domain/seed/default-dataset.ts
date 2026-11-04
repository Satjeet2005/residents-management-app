import { generateDemoDataset } from "@/domain/seed/generate";
import type { DemoDataset } from "@/domain/seed/types";

let cached: DemoDataset | undefined;

/** The default-seed dataset, generated once per test file. Tests must not change it. */
export function defaultDataset(): DemoDataset {
  cached ??= generateDemoDataset();
  return cached;
}

/** A stable serialisation: the generator builds objects in a fixed key order, and bigint becomes text. */
export function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v}n` : v));
}

export const FORCED_CODES = ["T07-1203", "T12-0408", "T21-1601", "T15-0902", "T03-0702", "T18-1105", "T26-0301"] as const;
export const NAMED_FORCED_CODES = ["T07-1203", "T12-0408", "T21-1601", "T15-0902"] as const;
