import { generateDemoDataset } from "@/domain/seed/generate";
import type { DemoBill, DemoDataset, DemoLedgerEntry } from "@/domain/seed/types";

let cached: DemoDataset | undefined;

/** The default-seed dataset, generated once per test file. Tests must not change it. */
export function defaultDataset(): DemoDataset {
  cached ??= generateDemoDataset();
  return cached;
}

type Index = {
  entriesByBill: Map<string, DemoLedgerEntry[]>;
  entriesByFlat: Map<string, DemoLedgerEntry[]>;
  billsByFlat: Map<string, DemoBill[]>;
};

const indexes = new WeakMap<DemoDataset, Index>();

function group<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [row]);
    else list.push(row);
  }
  return groups;
}

/** Lookups by bill and by flat, built once per dataset, so a test that loops over every bill does not rescan every entry. */
export function indexOf(dataset: DemoDataset): Index {
  let index = indexes.get(dataset);
  if (index === undefined) {
    index = {
      entriesByBill: group(dataset.ledgerEntries, (e) => e.billKey),
      entriesByFlat: group(dataset.ledgerEntries, (e) => e.flatKey),
      billsByFlat: group(dataset.bills, (b) => b.flatKey),
    };
    indexes.set(dataset, index);
  }
  return index;
}

/** A stable serialisation: the generator builds objects in a fixed key order, and bigint becomes text. */
export function serialise(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v}n` : v));
}

export const FORCED_CODES = ["T07-1203", "T12-0408", "T21-1601", "T15-0902", "T03-0702", "T18-1105", "T26-0301"] as const;
export const NAMED_FORCED_CODES = ["T07-1203", "T12-0408", "T21-1601", "T15-0902"] as const;
