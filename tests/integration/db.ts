import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { inject } from "vitest";

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: inject("testDatabaseUrl") });
  await client.connect();
  return client;
}

export const SQLSTATE = {
  restrictViolation: "23001",
  notNullViolation: "23502",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  checkViolation: "23514",
} as const;

export async function rejectedWith(promise: Promise<unknown>, code: string, constraint?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { code?: string; constraint?: string; message: string },
  );
  if (error === null) throw new Error("expected the statement to be rejected, but it succeeded");
  if (error.code !== code) throw new Error(`expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
  if (constraint !== undefined && error.constraint !== constraint) {
    throw new Error(`expected constraint ${constraint}, got ${error.constraint}`);
  }
}

const unique = () => randomUUID().slice(0, 8);

export async function insertFlat(db: Client): Promise<string> {
  const code = `T${unique()}`;
  const { rows } = await db.query(
    "INSERT INTO flats (code, tower, number, area_sqft) VALUES ($1, 'T12', '0408', 1000) RETURNING id",
    [code],
  );
  return rows[0].id;
}

export async function insertUser(db: Client): Promise<string> {
  const { rows } = await db.query(
    "INSERT INTO users (phone, name, role) VALUES ($1, 'Test User', 'RESIDENT') RETURNING id",
    [`+91${unique()}`],
  );
  return rows[0].id;
}

export async function insertBill(db: Client, flatId: string, period = "2026-04-01"): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO bills (flat_id, period, issued_on, due_on, amount_paise, area_sqft_snapshot, rate_paise_per_sqft)
     VALUES ($1, $2, '2026-04-01', '2026-04-10', 250000, 1000, 250) RETURNING id`,
    [flatId, period],
  );
  return rows[0].id;
}

type Entry = {
  entryType?: string;
  direction?: string;
  amountPaise?: number;
  reference?: string | null;
  idempotencyKey?: string;
  note?: string | null;
  reversesEntryId?: string | null;
};

export async function insertEntry(db: Client, flatId: string, e: Entry = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO ledger_entries
       (flat_id, entry_type, direction, amount_paise, effective_date, reference, idempotency_key, note, reverses_entry_id)
     VALUES ($1, $2, $3, $4, '2026-04-01', $5, $6, $7, $8) RETURNING id`,
    [
      flatId,
      e.entryType ?? "BILL",
      e.direction ?? "CHARGE",
      e.amountPaise ?? 1000,
      e.reference ?? null,
      e.idempotencyKey ?? `idem-${randomUUID()}`,
      e.note ?? null,
      e.reversesEntryId ?? null,
    ],
  );
  return rows[0].id;
}

type Attempt = {
  status?: string;
  amountPaise?: number;
  gatewayReference?: string | null;
  releaseReason?: string | null;
};

export async function insertAttempt(db: Client, billId: string, flatId: string, a: Attempt = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO payment_attempts (bill_id, flat_id, amount_paise, status, gateway_reference, release_reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [billId, flatId, a.amountPaise ?? 250000, a.status ?? "INITIATED", a.gatewayReference ?? null, a.releaseReason ?? null],
  );
  return rows[0].id;
}

export const uniqueRef = (prefix: string) => `${prefix}-${randomUUID()}`;
