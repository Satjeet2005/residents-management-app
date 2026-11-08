import type { Client } from "pg";

/** A seed-key prefix anywhere in a value: "user:5000000005", or the same inside JSON ("\"assignee\":\"user:5…\""). */
export const SEED_KEY_PATTERN = "(^|[^A-Za-z0-9])(user|flat|complaint|bill|member|staff):";

/** An idempotency key is an opaque unique string ("seed:bill:T01-0103:2026-06-01"), never looked up as an id, so it may spell a seed key. */
export const OPAQUE_COLUMNS = new Set(["ledger_entries.idempotency_key"]);

/** Every text, varchar and jsonb column of every table of the public schema, with the number of rows that hold a seed-key prefix. Only columns with a hit are returned. */
export async function scanSeedKeys(db: Client): Promise<{ column: string; rows: number }[]> {
  const columns = await db.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type IN ('text', 'character varying', 'jsonb', 'json') ORDER BY 1, 2`,
  );
  const hits: { column: string; rows: number }[] = [];
  for (const { table_name: table, column_name: column } of columns.rows) {
    if (OPAQUE_COLUMNS.has(`${table}.${column}`)) continue;
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}" WHERE "${column}"::text ~ $1`, [SEED_KEY_PATTERN]);
    if (rows[0].n > 0) hits.push({ column: `${table}.${column}`, rows: rows[0].n });
  }
  return hits;
}
