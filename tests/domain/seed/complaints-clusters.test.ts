import { describe, expect, it } from "vitest";
import { istDateOf } from "@/domain/time/calendar";
import { dataset } from "./complaint-helpers";

const byKey = new Map(dataset.complaints.map((c) => [c.key, c]));
const flatTower = new Map(dataset.flats.map((f) => [f.key, f.tower]));

/** Duplicates grouped under their primary. */
const incidents = (() => {
  const groups = new Map<string, string[]>();
  for (const l of dataset.links) groups.set(l.primaryKey, [...(groups.get(l.primaryKey) ?? []), l.duplicateKey]);
  return groups;
})();

describe("C6 duplicate clusters", () => {
  it("C6 there are exactly 6 incidents, of 12, 9, 7, 6, 5 and 4 complaints", () => {
    expect(incidents.size).toBe(6);
    expect([...incidents.values()].map((d) => d.length + 1).sort((a, b) => b - a)).toEqual([12, 9, 7, 6, 5, 4]);
  });

  it("C6 every duplicate appears once, no primary is a duplicate, no link points at itself", () => {
    const duplicates = dataset.links.map((l) => l.duplicateKey);
    expect(new Set(duplicates).size).toBe(duplicates.length);
    for (const primary of incidents.keys()) expect(duplicates, primary).not.toContain(primary);
    for (const l of dataset.links) expect(l.primaryKey).not.toBe(l.duplicateKey);
  });

  it("C6 an incident is different flats of one tower, one day, one category; the earliest is the primary", () => {
    for (const [primaryKey, duplicateKeys] of incidents) {
      const all = [primaryKey, ...duplicateKeys].map((k) => byKey.get(k)!);
      expect(new Set(all.map((c) => c.flatKey)).size, primaryKey).toBe(all.length);
      expect(new Set(all.map((c) => flatTower.get(c.flatKey))).size, primaryKey).toBe(1);
      expect(new Set(all.map((c) => istDateOf(c.createdAt))).size, primaryKey).toBe(1);
      expect(new Set(all.map((c) => c.categoryCode)).size, primaryKey).toBe(1);
      const primary = byKey.get(primaryKey)!;
      for (const c of all) expect(c.createdAt).toBeGreaterThanOrEqual(primary.createdAt);
    }
  });

  it("C6 the biggest incident is a lift outage in 12 flats of tower T07", () => {
    const [primaryKey, duplicates] = [...incidents].find(([, d]) => d.length === 11)!;
    const all = [primaryKey, ...duplicates].map((k) => byKey.get(k)!);
    expect(all.every((c) => c.categoryCode === "LIFT" && flatTower.get(c.flatKey) === "T07")).toBe(true);
  });

  it("C6 similarity is 0.80 to 0.98 and each link records a DUPLICATE_LINKED event", () => {
    for (const l of dataset.links) {
      expect(l.similarity).toBeGreaterThanOrEqual(0.8);
      expect(l.similarity).toBeLessThanOrEqual(0.98);
      expect(dataset.events.some((e) => e.complaintKey === l.duplicateKey && e.type === "DUPLICATE_LINKED" && e.createdAt === l.createdAt)).toBe(true);
    }
  });

  it("C6 three incidents have 3 to 8 further affected flats, which filed no complaint of their own", () => {
    const perIncident = new Map<string, string[]>();
    for (const a of dataset.affected) perIncident.set(a.complaintKey, [...(perIncident.get(a.complaintKey) ?? []), a.flatKey]);
    expect(perIncident.size).toBe(3);
    for (const [primaryKey, flatKeys] of perIncident) {
      expect(incidents.has(primaryKey)).toBe(true);
      expect(flatKeys.length).toBeGreaterThanOrEqual(3);
      expect(flatKeys.length).toBeLessThanOrEqual(8);
      expect(new Set(flatKeys).size).toBe(flatKeys.length);
      const members = [primaryKey, ...incidents.get(primaryKey)!].map((k) => byKey.get(k)!.flatKey);
      const tower = flatTower.get(members[0]);
      for (const flatKey of flatKeys) {
        expect(members).not.toContain(flatKey);
        expect(flatTower.get(flatKey)).toBe(tower);
      }
    }
  });
});
