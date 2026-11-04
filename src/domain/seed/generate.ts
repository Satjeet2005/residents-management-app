import { buildBilling } from "./billing";
import { buildFlats } from "./flats";
import { buildPeople } from "./people";
import { createPrng } from "./prng";
import { buildCategories, buildSettings } from "./settings";
import { DEFAULT_SEED, DEMO_AS_OF, type DemoDataset } from "./types";

export type DemoDatasetOptions = { seed?: number };

/**
 * The demo data, in memory and deterministic: the same seed gives the same dataset.
 * All of it is fictional. Rows are keyed by strings; the database writer maps keys to UUIDs.
 */
export function generateDemoDataset(options: DemoDatasetOptions = {}): DemoDataset {
  const seed = options.seed ?? DEFAULT_SEED;
  const rng = createPrng(seed);
  const flats = buildFlats(rng);
  const { users, members, staff } = buildPeople(flats, rng);
  const { bills, ledgerEntries } = buildBilling(flats, rng);
  const settings = buildSettings();
  const categories = buildCategories(users);
  return { seed, asOf: DEMO_AS_OF, flats, users, members, bills, ledgerEntries, staff, settings, categories };
}
