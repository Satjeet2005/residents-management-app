import { Client } from "pg";

/** One row of SQL read from the scratch database of this run (the connection string of the run with the database name of `scripts/e2e.sh`). Read only in practice: a spec asks, it never changes data this way. */
export async function sql<T>(text: string, params: unknown[] = []): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = "/township_seed_scratch";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query(text, params)).rows[0] as T;
  } finally {
    await client.end();
  }
}

/** Every row of a query, for a list. */
export async function sqlRows<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = "/township_seed_scratch";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}
