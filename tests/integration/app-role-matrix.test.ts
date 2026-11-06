import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_ACCESS_TABLES, PRIVILEGE_MATRIX, staleMatrixTables, undecidedTables } from "@/server/db-roles/app-role";
import { connect } from "./db";

let db: Client;
let tables: string[];

beforeAll(async () => {
  db = await connect();
  const { rows } = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  tables = rows.map((r) => r.tablename);
});
afterAll(() => db.end());

describe("D95 every table is covered by the privilege matrix", () => {
  it("D95 every table in the public schema of the migrated database has a decision (matrix or no-access list)", () => {
    expect(undecidedTables(tables), "add these tables to PRIVILEGE_MATRIX in src/server/db-roles/app-role.ts, and decide their privileges").toEqual([]);
  });

  it("D95 every table the matrix names exists (no stale entry after a rename or drop)", () => {
    expect(staleMatrixTables(tables), "remove or rename these in src/server/db-roles/app-role.ts").toEqual([]);
  });

  it("D95 the schema has the 25 tables of the matrix plus _prisma_migrations, nothing else", () => {
    expect(tables).toHaveLength(Object.keys(PRIVILEGE_MATRIX).length + NO_ACCESS_TABLES.length);
    expect(Object.keys(PRIVILEGE_MATRIX)).toHaveLength(25);
    expect(tables).toContain("_prisma_migrations");
  });

  it("D95 no table is in both the matrix and the no-access list", () => {
    for (const table of NO_ACCESS_TABLES) expect(PRIVILEGE_MATRIX[table]).toBeUndefined();
  });

  it("D95 the checker names a table that has no decision, and a matrix entry with no table", () => {
    expect(undecidedTables([...tables, "invoices_2027"])).toEqual(["invoices_2027"]);
    expect(undecidedTables(["zz_a", "aa_b"])).toEqual(["aa_b", "zz_a"]);
    expect(staleMatrixTables(tables.filter((t) => t !== "flats"))).toEqual(["flats"]);
  });
});
