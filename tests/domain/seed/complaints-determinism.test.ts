import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/domain/seed/generate";
import type { DemoDataset } from "@/domain/seed/types";
import { defaultDataset, serialise } from "./default-dataset";

const FORCED_IDS = ["forced-water-leak", "forced-corridor-light", "forced-garbage", "forced-gas-smell"];

const newData = (d: DemoDataset) => ({
  settings: d.settings,
  categories: d.categories,
  complaints: d.complaints,
  events: d.events,
  classifications: d.classifications,
  links: d.links,
  affected: d.affected,
  visitorPasses: d.visitorPasses,
  knownPayers: d.knownPayers,
  notifications: d.notifications,
});

/**
 * The forced complaints and everything recorded about them. The gas complaint's
 * flat is "the first flat of T09", which can change with the seed, so its flat
 * and resident are replaced by placeholders.
 */
function forcedFacts(d: DemoDataset) {
  return FORCED_IDS.map((id) => {
    const key = `complaint:${id}`;
    const complaint = d.complaints.find((c) => c.key === key);
    if (complaint === undefined) throw new Error(`${key} is missing`);
    const anonymous = id === "forced-gas-smell";
    const hide = <T extends { actorUserKey?: string | null }>(row: T): T =>
      anonymous && row.actorUserKey === complaint.raisedByUserKey ? { ...row, actorUserKey: "RESIDENT" } : row;
    return {
      complaint: anonymous ? { ...complaint, flatKey: "FLAT", raisedByUserKey: "RESIDENT" } : complaint,
      events: d.events.filter((e) => e.complaintKey === key).map(hide),
      classification: d.classifications.find((c) => c.complaintKey === key),
    };
  });
}

describe("C1 determinism and forced complaints", () => {
  // Builds the 2,400-flat dataset three times by design, so it needs more than the 5 s default on a loaded 2-CPU machine.
  it("C1 the same seed gives identical settings, complaints, visitors, payers and notifications", () => {
    expect(serialise(newData(generateDemoDataset({ seed: 42 })))).toBe(serialise(newData(generateDemoDataset({ seed: 42 }))));
    expect(serialise(newData(generateDemoDataset()))).toBe(serialise(newData(defaultDataset())));
  }, 20_000);

  it.each([1, 2, 20261028])("C1 seed %i changes the random complaints", (seed) => {
    const other = generateDemoDataset({ seed });
    expect(serialise(other.complaints)).not.toBe(serialise(defaultDataset().complaints));
    expect(serialise(other.visitorPasses)).not.toBe(serialise(defaultDataset().visitorPasses));
    expect(serialise(other.knownPayers)).not.toBe(serialise(defaultDataset().knownPayers));
  });

  it.each([1, 2, 20261028])("C1 seed %i leaves the four forced complaints identical", (seed) => {
    expect(serialise(forcedFacts(generateDemoDataset({ seed })))).toBe(serialise(forcedFacts(defaultDataset())));
  });
});
