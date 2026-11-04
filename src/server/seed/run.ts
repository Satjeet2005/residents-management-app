import type { Client } from "pg";
import type { DemoDataset } from "@/domain/seed/types";
import { type GuardResult, checkEmpty } from "./guards";
import { writeDemoDataset } from "./writer";

export type SeedOutcome = { ok: true; counts: Record<string, number> } | Extract<GuardResult, { ok: false }>;

/** Writes the dataset unless the database already has flats; a second run is refused and changes nothing. */
export async function seedDemoDatabase(db: Client, dataset: DemoDataset): Promise<SeedOutcome> {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM flats");
  const empty = checkEmpty(rows[0].n);
  if (!empty.ok) return empty;
  return { ok: true, counts: await writeDemoDataset(db, dataset) };
}
