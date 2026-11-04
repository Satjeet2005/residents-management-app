import type { Client } from "pg";
import type { DemoDataset } from "@/domain/seed/types";
import { type SeedRow, type SeedTable, buildSeedTables } from "./rows";

const BATCH_SIZE = 1000;

/** The first database error, with the table, the constraint that fired and the key of the row. */
export class SeedWriteError extends Error {
  constructor(
    readonly table: string,
    readonly rowKey: string,
    readonly constraint: string | null,
    readonly reason: string,
  ) {
    super(`Seeding stopped in table ${table} at row ${rowKey}: ${reason}${constraint === null ? "" : ` (constraint ${constraint})`}`);
    this.name = "SeedWriteError";
  }
}

type DbError = { message: string; constraint?: string };

function insertSql(table: string, columns: readonly string[], rowCount: number): string {
  const width = columns.length;
  const groups = Array.from({ length: rowCount }, (_, r) => `(${columns.map((_c, c) => `$${r * width + c + 1}`).join(", ")})`);
  return `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${groups.join(", ")}`;
}

async function insertRows(db: Client, table: string, columns: readonly string[], rows: readonly SeedRow[]): Promise<void> {
  await db.query(insertSql(table, columns, rows.length), rows.flatMap((r) => r.values));
}

/** After a failed batch, finds the row that fails by inserting the rows one at a time under savepoints. */
async function findFailingRow(db: Client, table: SeedTable, batch: readonly SeedRow[], batchError: DbError): Promise<SeedWriteError> {
  for (const row of batch) {
    await db.query("SAVEPOINT one_row");
    try {
      await insertRows(db, table.table, table.columns, [row]);
      await db.query("RELEASE SAVEPOINT one_row");
    } catch (error) {
      const e = error as DbError;
      return new SeedWriteError(table.table, row.key, e.constraint ?? null, e.message);
    }
  }
  return new SeedWriteError(table.table, batch[0].key, batchError.constraint ?? null, batchError.message);
}

/**
 * Writes the dataset in foreign-key order inside ONE transaction, about 1,000 rows
 * per INSERT. The first database error rolls everything back and is reported as a
 * SeedWriteError. Returns the number of rows written per table.
 */
export async function writeDemoDataset(db: Client, dataset: DemoDataset): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await db.query("BEGIN");
  try {
    for (const table of buildSeedTables(dataset)) {
      for (let start = 0; start < table.rows.length; start += BATCH_SIZE) {
        const batch = table.rows.slice(start, start + BATCH_SIZE);
        await db.query("SAVEPOINT batch");
        try {
          await insertRows(db, table.table, table.columns, batch);
          await db.query("RELEASE SAVEPOINT batch");
        } catch (error) {
          await db.query("ROLLBACK TO SAVEPOINT batch");
          throw await findFailingRow(db, table, batch, error as DbError);
        }
      }
      counts[table.table] = table.rows.length;
    }
    await db.query("COMMIT");
    return counts;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
