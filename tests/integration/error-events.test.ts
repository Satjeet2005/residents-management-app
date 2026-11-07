import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQLSTATE, connect, rejectedWith } from "./db";

/** D135: the shape of the durable error log. The CHECKs are the backstop for a bug in the writer. */

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(() => db.end());

let counter = 0;
async function insert(values: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const row = {
    level: "ERROR",
    source: "ROUTE",
    ref: `E-T${String(++counter).padStart(5, "0")}`,
    route: "/api/x",
    error_name: "Error",
    message: "boom",
    environment: "test",
    fingerprint: "f".repeat(64),
    ...values,
  };
  const names = Object.keys(row);
  const { rows } = await db.query(`INSERT INTO error_events (${names.join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, Object.values(row));
  return rows[0];
}

describe("D135 error_events", () => {
  it("D135 a minimal row gets an id, a time, and a suppressed count of 0; the optional columns are null", async () => {
    const row = await insert();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.occurred_at).toBeInstanceOf(Date);
    expect(row.suppressed_count).toBe(0);
    for (const column of ["digest", "request_id", "method", "status", "error_code", "stack", "user_id", "role", "deployment"]) expect(row[column]).toBeNull();
  });

  it("D135 the reference is unique", async () => {
    await insert({ ref: "E-DUP001" });
    await rejectedWith(insert({ ref: "E-DUP001" }), SQLSTATE.uniqueViolation, "error_events_ref_key");
  });

  it.each(["WARN", "ERROR"])("D135 level %s is accepted", async (level) => {
    await expect(insert({ level })).resolves.toBeDefined();
  });

  it.each(["INFO", "warn", ""])("D135 level %j is refused", async (level) => {
    await rejectedWith(insert({ level }), SQLSTATE.checkViolation, "error_events_level_known");
  });

  it.each(["ROUTE", "PAGE", "ACTION", "MIDDLEWARE", "PROVIDER", "JOB", "AUDIT", "TEST"])("D135 source %s is accepted", async (source) => {
    await expect(insert({ source })).resolves.toBeDefined();
  });

  it("D135 an unknown source is refused", async () => {
    await rejectedWith(insert({ source: "CRON" }), SQLSTATE.checkViolation, "error_events_source_known");
  });

  it("D135 a message of 500 characters is accepted and 501 is refused", async () => {
    await expect(insert({ message: "m".repeat(500) })).resolves.toBeDefined();
    await rejectedWith(insert({ message: "m".repeat(501) }), SQLSTATE.checkViolation, "error_events_message_length");
  });

  it("D135 a stack of 4,000 characters is accepted and 4,001 is refused", async () => {
    await expect(insert({ stack: "s".repeat(4000) })).resolves.toBeDefined();
    await rejectedWith(insert({ stack: "s".repeat(4001) }), SQLSTATE.checkViolation, "error_events_stack_length");
  });

  it("D135 a negative suppressed count is refused", async () => {
    await expect(insert({ suppressed_count: 7 })).resolves.toBeDefined();
    await rejectedWith(insert({ suppressed_count: -1 }), SQLSTATE.checkViolation, "error_events_suppressed_count_not_negative");
  });

  it("D135 user_id has no foreign key: an unknown user id is accepted", async () => {
    await expect(insert({ user_id: "00000000-0000-4000-8000-000000000001" })).resolves.toBeDefined();
    const { rows } = await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'error_events'::regclass AND contype = 'f'");
    expect(rows[0].n).toBe(0);
  });

  it("D135 the four indexes exist, and the time index is descending", async () => {
    const { rows } = await db.query<{ indexname: string; indexdef: string }>("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'error_events'");
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.error_events_occurred_at_idx).toContain("(occurred_at DESC)");
    expect(defs.error_events_digest_idx).toContain("(digest)");
    expect(defs.error_events_request_id_idx).toContain("(request_id)");
    expect(defs.error_events_fingerprint_occurred_at_idx).toContain("(fingerprint, occurred_at)");
  });
});
