import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQLSTATE, connect, insertRow, rejectedWith } from "./db";

let db: Client;

beforeAll(async () => {
  db = await connect();
});
afterAll(() => db.end());

const code = (values: Record<string, unknown> = {}) =>
  insertRow(db, "otp_codes", { phone: "5000000001", code_hash: "x", expires_at: "2026-11-06T10:00:00Z", ...values });

describe("M1 otp_codes", () => {
  it("M1 requested_ip_hash is nullable", async () => {
    const id = await code();
    const { rows } = await db.query("SELECT requested_ip_hash FROM otp_codes WHERE id = $1", [id]);
    expect(rows[0].requested_ip_hash).toBeNull();
    await expect(code({ requested_ip_hash: "abc" })).resolves.toBeDefined();
  });

  it.each([0, 1, 5, 100])("M1 attempts = %i is accepted", async (attempts) => {
    await expect(code({ attempts })).resolves.toBeDefined();
  });

  it.each([-1, 101, 1000])("M1 attempts = %i is rejected by otp_codes_attempts_bounded", async (attempts) => {
    await rejectedWith(code({ attempts }), SQLSTATE.checkViolation, "otp_codes_attempts_bounded");
  });

  it("M1 an UPDATE past the bound is rejected too", async () => {
    const id = await code({ attempts: 100 });
    await rejectedWith(db.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", [id]), SQLSTATE.checkViolation, "otp_codes_attempts_bounded");
  });

  it("M1 has an index on (phone, created_at) and one on (requested_ip_hash, created_at)", async () => {
    const { rows } = await db.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'otp_codes'",
    );
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs["otp_codes_phone_created_at_idx"]).toContain("(phone, created_at)");
    expect(defs["otp_codes_requested_ip_hash_created_at_idx"]).toContain("(requested_ip_hash, created_at)");
  });
});
