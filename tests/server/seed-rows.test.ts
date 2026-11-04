import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { istDateOf } from "@/domain/time/calendar";
import { buildSeedTables } from "@/server/seed/rows";
import { uuidFromKey } from "@/server/seed/uuid";
import { defaultDataset } from "../domain/seed/default-dataset";

const d = defaultDataset();
const tables = buildSeedTables(d);
const rowsOf = (name: string) => tables.find((t) => t.table === name)!;
const valueOf = (name: string, rowIndex: number, column: string) => {
  const t = rowsOf(name);
  return t.rows[rowIndex].values[t.columns.indexOf(column)];
};

describe("W1 seed rows", () => {
  it("W1 tables come in foreign-key order", () => {
    expect(tables.map((t) => t.table)).toEqual([
      "users", "user_permissions", "flats", "flat_members", "society_settings", "bills", "ledger_entries",
      "complaint_categories", "complaints", "complaint_events", "classifications", "complaint_links",
      "complaint_affected", "visitor_passes", "known_payers", "notifications",
    ]);
  });

  it("W1 row counts equal the dataset's counts", () => {
    const expected: Record<string, number> = {
      users: d.users.length,
      user_permissions: d.staff.reduce((n, s) => n + s.permissions.length, 0),
      flats: d.flats.length,
      flat_members: d.members.length,
      society_settings: d.settings.length,
      bills: d.bills.length,
      ledger_entries: d.ledgerEntries.length,
      complaint_categories: d.categories.length,
      complaints: d.complaints.length,
      complaint_events: d.events.length,
      classifications: d.classifications.length,
      complaint_links: d.links.length,
      complaint_affected: d.affected.length,
      visitor_passes: d.visitorPasses.length,
      known_payers: d.knownPayers.length,
      notifications: d.notifications.length,
    };
    for (const t of tables) expect(t.rows.length, t.table).toBe(expected[t.table]);
  });

  it("W1 every row has one value per column and every key is unique within its table", () => {
    for (const t of tables) {
      for (const row of t.rows) expect(row.values.length, `${t.table} ${row.key}`).toBe(t.columns.length);
      expect(new Set(t.rows.map((r) => r.key)).size, t.table).toBe(t.rows.length);
    }
  });

  it("W1 ids are the deterministic UUIDs of the keys, and references use the same mapping", () => {
    expect(valueOf("flats", 0, "id")).toBe(uuidFromKey(d.flats[0].key));
    expect(valueOf("bills", 0, "flat_id")).toBe(uuidFromKey(d.bills[0].flatKey));
    expect(valueOf("complaints", 0, "category_id")).toBe(uuidFromKey(`category:${d.complaints[0].categoryCode}`));
  });

  it("W1 money is exact text and dates are DATE strings", () => {
    expect(valueOf("bills", 0, "amount_paise")).toBe(d.bills[0].amountPaise.toString());
    expect(valueOf("bills", 0, "period")).toBe(d.bills[0].period);
    expect(valueOf("ledger_entries", 0, "amount_paise")).toBe(d.ledgerEntries[0].amountPaise.toString());
    expect(valueOf("ledger_entries", 0, "effective_date")).toBe(d.ledgerEntries[0].effectiveDate);
  });

  it("W1 created_at of complaints, events, classifications and notifications is the dataset time", () => {
    expect((valueOf("complaints", 5, "created_at") as Date).getTime()).toBe(d.complaints[5].createdAt);
    expect((valueOf("complaint_events", 5, "created_at") as Date).getTime()).toBe(d.events[5].createdAt);
    expect((valueOf("classifications", 5, "created_at") as Date).getTime()).toBe(d.classifications[5].createdAt);
    expect((valueOf("notifications", 5, "created_at") as Date).getTime()).toBe(d.notifications[5].createdAt);
  });

  it("W1 columns the dataset lacks are not written, so the database leaves them NULL", () => {
    for (const column of ["latency_ms", "output_hash", "created_by_id", "language"]) {
      for (const t of tables) expect(t.columns, `${t.table}.${column}`).not.toContain(column);
    }
  });

  it("W1 a classification without confidence is written as NULL, and one with it has 3 decimals", () => {
    const k = rowsOf("classifications");
    const confidences = k.rows.map((r) => r.values[k.columns.indexOf("confidence")]);
    expect(confidences).toContain(null);
    for (const c of confidences) if (c !== null) expect(c).toMatch(/^0\.\d{3}$/);
  });

  it("W1 a ledger entry's created_at is on the same IST day as its effective date (noon), never the time of the seed", () => {
    const t = rowsOf("ledger_entries");
    const created = t.columns.indexOf("created_at");
    const effective = t.columns.indexOf("effective_date");
    expect(t.rows.length).toBeGreaterThan(20000);
    for (const row of t.rows) {
      const at = (row.values[created] as Date).getTime();
      expect(istDateOf(at), row.key).toBe(row.values[effective]);
      expect(at, row.key).toBeLessThanOrEqual(DEMO_NOW);
    }
  });

  it("W1 a bill's ledger entries are never created before the bill's issue date", () => {
    const issued = new Map(d.bills.map((b) => [b.key, b.issuedOn]));
    const t = rowsOf("ledger_entries");
    const created = t.columns.indexOf("created_at");
    for (const [i, entry] of d.ledgerEntries.entries()) {
      expect(istDateOf((t.rows[i].values[created] as Date).getTime()) >= (issued.get(entry.billKey as string) as string), entry.key).toBe(true);
    }
  });

  it("W1 a known payer's created_at is not before the start of its flat's earliest member", () => {
    const earliest = new Map<string, string>();
    for (const m of d.members) if (!earliest.has(m.flatKey) || m.startsOn < (earliest.get(m.flatKey) as string)) earliest.set(m.flatKey, m.startsOn);
    const t = rowsOf("known_payers");
    const created = t.columns.indexOf("created_at");
    const flat = t.columns.indexOf("flat_id");
    const flatKeyOf = new Map(d.flats.map((f) => [uuidFromKey(f.key), f.key]));
    expect(t.rows.length).toBe(720);
    for (const row of t.rows) {
      const flatKey = flatKeyOf.get(row.values[flat] as string) as string;
      const at = (row.values[created] as Date).getTime();
      expect(istDateOf(at), row.key).toBe(earliest.get(flatKey));
      expect(at, row.key).toBeLessThanOrEqual(DEMO_NOW);
    }
  });

  it("W1 no created_at, sent_at or read_at in any table is later than DEMO_NOW", () => {
    for (const t of tables) {
      for (const column of ["created_at", "sent_at", "read_at", "first_response_at", "pending_confirmation_at", "closed_at"]) {
        const index = t.columns.indexOf(column);
        if (index === -1) continue;
        for (const row of t.rows) {
          const value = row.values[index] as Date | null;
          if (value !== null) expect(value.getTime(), `${t.table}.${column} ${row.key}`).toBeLessThanOrEqual(DEMO_NOW);
        }
      }
    }
  });
});
