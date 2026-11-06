import { describe, expect, it } from "vitest";
import { APPEND_ONLY_TABLES, NO_ACCESS_TABLES, PRIVILEGE_MATRIX, buildAppRoleSql, buildAppRoleStatements } from "@/server/db-roles/app-role";

const OPTIONS = { appRole: "township_app", ownerRole: "neondb_owner" };
const statements = buildAppRoleStatements(OPTIONS);
const grants = statements.filter((s) => s.startsWith("GRANT "));

/** What the GRANT statements give, per table, read back from the text: { table: { privileges, updateColumns } }. */
function effective() {
  const result: Record<string, { privileges: Set<string>; updateColumns: Set<string> }> = {};
  const entry = (table: string) => (result[table] ??= { privileges: new Set(), updateColumns: new Set() });
  for (const grant of grants) {
    const column = /^GRANT UPDATE \((.+)\) ON "([a-z_]+)" TO /.exec(grant);
    if (column) {
      for (const c of column[1].split(", ")) entry(column[2]).updateColumns.add(c.replace(/"/g, ""));
      continue;
    }
    const table = /^GRANT ((?:SELECT|INSERT)(?:, (?:SELECT|INSERT))*) ON ("[a-z_]+"(?:, "[a-z_]+")*) TO "township_app";$/.exec(grant);
    if (!table) continue;
    for (const t of table[2].split(", ")) for (const p of table[1].split(", ")) entry(t.replace(/"/g, "")).privileges.add(p);
  }
  return result;
}

describe("D95 buildAppRoleSql: identifiers", () => {
  it.each(["township_app", "app", "a_1", "x".repeat(41), "abc"])("accepts %s as the app role", (name) => {
    expect(() => buildAppRoleSql({ appRole: name, ownerRole: "neondb_owner" })).not.toThrow();
  });

  it.each(["", "ab", "Township", "1app", "_app", "app-role", "app role", "app;drop", 'app"', "app'x", "x".repeat(42), "app\n", "приложение", "app.role"])(
    "refuses %j as the app role",
    (name) => {
      expect(() => buildAppRoleSql({ appRole: name, ownerRole: "neondb_owner" })).toThrow(RangeError);
    },
  );

  it.each(["", "Neon", "owner;", 'o"o', "ab"])("refuses %j as the owner role", (name) => {
    expect(() => buildAppRoleSql({ appRole: "township_app", ownerRole: name })).toThrow(RangeError);
  });

  it("refuses the same role as app and owner", () => {
    expect(() => buildAppRoleSql({ appRole: "same_role", ownerRole: "same_role" })).toThrow(/different/);
  });

  it("quotes the role names", () => {
    expect(buildAppRoleSql(OPTIONS)).toContain('TO "township_app"');
  });
});

describe("D95 buildAppRoleSql: what it grants", () => {
  const given = effective();

  it("grants exactly the matrix: privileges and UPDATE columns, table by table", () => {
    for (const [table, grant] of Object.entries(PRIVILEGE_MATRIX)) {
      const expectedPrivileges = [grant.select ? "SELECT" : null, grant.insert ? "INSERT" : null].filter(Boolean).sort();
      expect([...(given[table]?.privileges ?? [])].sort(), table).toEqual(expectedPrivileges);
      expect([...(given[table]?.updateColumns ?? [])].sort(), `${table} columns`).toEqual([...(grant.updateColumns ?? [])].sort());
    }
    expect(Object.keys(given).sort()).toEqual(Object.keys(PRIVILEGE_MATRIX).sort());
  });

  it.each(APPEND_ONLY_TABLES)("%s gets SELECT and INSERT only: no UPDATE (not even a column), no DELETE, no TRUNCATE", (table) => {
    expect([...given[table].privileges].sort()).toEqual(["INSERT", "SELECT"]);
    expect(given[table].updateColumns.size).toBe(0);
  });

  it("the only UPDATE grants are the columns of sessions and one-time codes", () => {
    const withUpdate = Object.entries(given).filter(([, g]) => g.updateColumns.size > 0).map(([t, g]) => [t, [...g.updateColumns].sort()]);
    expect(withUpdate).toEqual([["sessions", ["last_seen_at", "revoked_at"]], ["otp_codes", ["attempts", "consumed_at"]]]);
  });

  it("every GRANT is one of three known forms: USAGE on the schema, SELECT/INSERT on tables, or UPDATE on named columns (a whole-table UPDATE is not a form)", () => {
    const forms = [
      /^GRANT USAGE ON SCHEMA public TO "township_app";$/,
      /^GRANT (?:SELECT|INSERT)(?:, INSERT)? ON "[a-z_]+"(?:, "[a-z_]+")* TO "township_app";$/,
      /^GRANT UPDATE \("[a-z_]+"(?:, "[a-z_]+")*\) ON "[a-z_]+" TO "township_app";$/,
    ];
    for (const grant of grants) expect(forms.some((form) => form.test(grant)), grant).toBe(true);
  });

  it("no GRANT mentions DELETE, TRUNCATE, REFERENCES, TRIGGER, ALL, CREATE or OPTION", () => {
    for (const grant of grants) expect(grant, grant).not.toMatch(/\b(DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL|CREATE|OPTION)\b/);
  });

  it("no GRANT names _prisma_migrations", () => {
    for (const table of NO_ACCESS_TABLES) for (const grant of grants) expect(grant).not.toContain(table);
  });

  it("uses no default privileges, makes no role, sets no password and is not a superuser grant", () => {
    const text = buildAppRoleSql(OPTIONS);
    expect(text).not.toMatch(/ALTER DEFAULT PRIVILEGES/i);
    expect(statements.some((s) => /^\s*(CREATE|ALTER|DROP) ROLE/i.test(s))).toBe(false);
    expect(text).not.toMatch(/PASSWORD\s+'/i);
    expect(text).not.toMatch(/\bLOGIN\s+PASSWORD\b/i);
    expect(text).not.toMatch(/GRANT\s+[^;]*\bTO\s+PUBLIC/i);
    expect(grants.some((g) => g.includes("neon_superuser"))).toBe(false);
  });

  it("takes CREATE on the schema away from PUBLIC and from the app role, and resets the app role first", () => {
    expect(statements).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
    expect(statements).toContain('REVOKE CREATE ON SCHEMA public FROM "township_app";');
    expect(statements).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "township_app";');
    expect(statements.indexOf('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "township_app";')).toBeLessThan(statements.findIndex((s) => s.startsWith("GRANT SELECT")));
  });

  it("starts with a guard that checks the running role, the app role's attributes, ownership, neon_superuser and unknown tables", () => {
    const guard = statements[0];
    expect(guard).toContain("current_user <> 'neondb_owner'");
    expect(guard).toContain("rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication");
    expect(guard).toContain("pg_has_role('township_app', 'neon_superuser', 'member')");
    expect(guard).toContain("tableowner = 'township_app'");
    expect(guard).toContain("No privilege decision for table(s)");
    for (const table of [...Object.keys(PRIVILEGE_MATRIX), ...NO_ACCESS_TABLES]) expect(guard).toContain(`'${table}'`);
  });

  it("is the same every time", () => {
    expect(buildAppRoleSql(OPTIONS)).toBe(buildAppRoleSql(OPTIONS));
  });
});
