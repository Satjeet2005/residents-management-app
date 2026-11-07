import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { inject } from "vitest";
import { buildAppRoleSql } from "@/server/db-roles/app-role";
import { buildLogsRoleSql } from "@/server/db-roles/logs-role";
import { connect } from "./db";

export type TestAppRole = {
  name: string;
  /** Connection string of the test database, logging in as the app role. */
  url: string;
  ownerRole: string;
  /** The grants that were applied. */
  sql: string;
  /** Opens a connection as the app role. */
  open: () => Promise<Client>;
  /** Removes the grants and the role. Call it in afterAll, after the app connections are closed. */
  drop: () => Promise<void>;
};

/**
 * Makes a login role with a unique name and a random password (generated here, never stored or printed), applies the
 * generated grants as the owner, and returns a way to connect as it. Only this one role is created and dropped.
 */
export async function createAppRole(owner: Client, baseUrl: string = inject("testDatabaseUrl")): Promise<TestAppRole> {
  const name = `app_t_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const ownerRole = (await owner.query<{ current_user: string }>("SELECT current_user")).rows[0].current_user;
  await owner.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}'`);
  const sql = buildAppRoleSql({ appRole: name, ownerRole });
  try {
    await owner.query(sql);
  } catch (error) {
    await owner.query(`DROP ROLE IF EXISTS "${name}"`);
    throw error;
  }
  const url = new URL(baseUrl);
  url.username = name;
  url.password = password;
  return {
    name,
    url: url.toString(),
    ownerRole,
    sql,
    open: async () => {
      const client = new Client({ connectionString: url.toString() });
      await client.connect();
      return client;
    },
    drop: async () => {
      const cleanup = await connect();
      try {
        await cleanup.query(`DROP OWNED BY "${name}"`);
        await cleanup.query(`DROP ROLE IF EXISTS "${name}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** SQLSTATE of the error a statement raises, or null if it succeeded. */
export async function sqlState(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(() => null, (e: unknown) => (e as { code?: string }).code ?? "no-code");
}

/**
 * Makes the read-only logs role the same way (a login role with a random password, then the generated grants as the owner). Its name starts with
 * app_t_ like the app roles, so the test cleanup rule covers it.
 */
export async function createLogsRole(owner: Client, baseUrl: string = inject("testDatabaseUrl")): Promise<TestAppRole> {
  const name = `app_t_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const ownerRole = (await owner.query<{ current_user: string }>("SELECT current_user")).rows[0].current_user;
  await owner.query(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}'`);
  const sql = buildLogsRoleSql({ logsRole: name, ownerRole });
  try {
    await owner.query(sql);
  } catch (error) {
    await owner.query(`DROP ROLE IF EXISTS "${name}"`);
    throw error;
  }
  const url = new URL(baseUrl);
  url.username = name;
  url.password = password;
  return {
    name,
    url: url.toString(),
    ownerRole,
    sql,
    open: async () => {
      const client = new Client({ connectionString: url.toString() });
      await client.connect();
      return client;
    },
    drop: async () => {
      const cleanup = await connect();
      try {
        await cleanup.query(`DROP OWNED BY "${name}"`);
        await cleanup.query(`DROP ROLE IF EXISTS "${name}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
