import { describe, expect, it } from "vitest";
import { uuidFromKey } from "@/server/seed/uuid";
import { defaultDataset } from "../domain/seed/default-dataset";

describe("U1 uuidFromKey", () => {
  it("U1 is deterministic: the same key gives the same UUID", () => {
    expect(uuidFromKey("flat:T12-0408")).toBe(uuidFromKey("flat:T12-0408"));
  });

  it("U1 has a fixed value for a known key, so a change of namespace or method is noticed", () => {
    expect(uuidFromKey("flat:T12-0408")).toBe("85001028-6fdb-5cde-bdb8-b961895589a0");
  });

  it("U1 is a lower-case version-5-style UUID with the RFC 4122 variant", () => {
    for (const key of ["", "a", "user:5000000001", "complaint:forced-gas-smell"]) {
      expect(uuidFromKey(key)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("U1 different keys give different UUIDs", () => {
    expect(uuidFromKey("flat:T12-0408")).not.toBe(uuidFromKey("flat:T12-0409"));
    expect(uuidFromKey("a")).not.toBe(uuidFromKey("A"));
  });

  it("U1 within each table of the default dataset, no two keys share a UUID", () => {
    const d = defaultDataset();
    // A bill and its BILL ledger entry share a key, so uniqueness is per table.
    const tables: Record<string, string[]> = {
      flats: d.flats.map((r) => r.key),
      users: d.users.map((r) => r.key),
      bills: d.bills.map((r) => r.key),
      ledgerEntries: d.ledgerEntries.map((r) => r.key),
      categories: d.categories.map((r) => r.key),
      complaints: d.complaints.map((r) => r.key),
      events: d.events.map((r) => r.key),
    };
    for (const [table, keys] of Object.entries(tables)) {
      expect(new Set(keys).size, `${table} keys`).toBe(keys.length);
      expect(new Set(keys.map(uuidFromKey)).size, `${table} uuids`).toBe(keys.length);
    }
  });
});
