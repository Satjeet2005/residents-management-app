import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { inject } from "vitest";

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: inject("testDatabaseUrl") });
  await client.connect();
  return client;
}

export const SQLSTATE = {
  featureNotSupported: "0A000",
  restrictViolation: "23001",
  notNullViolation: "23502",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  checkViolation: "23514",
} as const;

export async function rejectedWith(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
  messagePart?: string,
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { code?: string; constraint?: string; message: string },
  );
  if (error === null) throw new Error("expected the statement to be rejected, but it succeeded");
  if (error.code !== code) throw new Error(`expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
  if (constraint !== undefined && error.constraint !== constraint) {
    throw new Error(`expected constraint ${constraint}, got ${error.constraint}`);
  }
  if (messagePart !== undefined && !error.message.includes(messagePart)) {
    throw new Error(`expected the message to include "${messagePart}", got: ${error.message}`);
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
  bankRowId?: string | null;
};

export async function insertEntry(db: Client, flatId: string, e: Entry = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO ledger_entries
       (flat_id, entry_type, direction, amount_paise, effective_date, reference, idempotency_key, note, reverses_entry_id, bank_row_id)
     VALUES ($1, $2, $3, $4, '2026-04-01', $5, $6, $7, $8, $9) RETURNING id`,
    [
      flatId,
      e.entryType ?? "BILL",
      e.direction ?? "CHARGE",
      e.amountPaise ?? 1000,
      e.reference ?? null,
      e.idempotencyKey ?? `idem-${randomUUID()}`,
      e.note ?? null,
      e.reversesEntryId ?? null,
      e.bankRowId ?? null,
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

export async function insertImport(db: Client, uploadedById: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO statement_imports (uploaded_by_id, filename, file_sha256, rows_read)
     VALUES ($1, 'statement.csv', $2, 10) RETURNING id`,
    [uploadedById, unique()],
  );
  return rows[0].id;
}

type BankRow = {
  rowNumber?: number;
  creditPaise?: number;
  debitPaise?: number;
  dedupeKey?: string;
  state?: string;
  flatId?: string | null;
  ledgerEntryId?: string | null;
};

let nextRowNumber = 1;

export async function insertBankRow(db: Client, importId: string, r: BankRow = {}): Promise<string> {
  const hasAmounts = r.creditPaise !== undefined || r.debitPaise !== undefined;
  const { rows } = await db.query(
    `INSERT INTO bank_rows
       (import_id, row_number, txn_date, narration_raw, credit_paise, debit_paise, dedupe_key, state, flat_id, ledger_entry_id)
     VALUES ($1, $2, '2026-04-05', 'UPI/FAKE PAYER/placeholder', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      importId,
      r.rowNumber ?? nextRowNumber++,
      hasAmounts ? (r.creditPaise ?? 0) : 250000,
      hasAmounts ? (r.debitPaise ?? 0) : 0,
      r.dedupeKey ?? `dedupe-${randomUUID()}`,
      r.state ?? "QUEUED",
      r.flatId ?? null,
      r.ledgerEntryId ?? null,
    ],
  );
  return rows[0].id;
}

type Match = {
  decision?: string;
  decidedById?: string | null;
  approverId?: string | null;
  reason?: string | null;
};

export async function insertMatch(db: Client, bankRowId: string, m: Match = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO payment_matches (bank_row_id, decision, decided_by_id, approver_id, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [bankRowId, m.decision ?? "AUTO", m.decidedById ?? null, m.approverId ?? null, m.reason ?? null],
  );
  return rows[0].id;
}

type QueueItem = {
  itemType: string;
  bankRowId?: string | null;
  paymentAttemptId?: string | null;
  status?: string;
  resolvedAt?: string | null;
  resolvedById?: string | null;
  note?: string | null;
};

export async function insertQueueItem(db: Client, q: QueueItem): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO accounts_queue_items
       (item_type, bank_row_id, payment_attempt_id, status, resolved_at, resolved_by_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      q.itemType,
      q.bankRowId ?? null,
      q.paymentAttemptId ?? null,
      q.status ?? "OPEN",
      q.resolvedAt ?? null,
      q.resolvedById ?? null,
      q.note ?? null,
    ],
  );
  return rows[0].id;
}

export async function insertKnownPayer(
  db: Client,
  flatId: string,
  identifierType: string,
  identifierValue: string,
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO known_payers (flat_id, identifier_type, identifier_value, source)
     VALUES ($1, $2, $3, 'MANUAL') RETURNING id`,
    [flatId, identifierType, identifierValue],
  );
  return rows[0].id;
}

/** Inserts one row from column/value pairs (snake_case) and returns its id. Test code only. */
export async function insertRow(db: Client, table: string, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const { rows } = await db.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return rows[0].id;
}

export const insertComplaint = (
  db: Client,
  flatId: string,
  raisedById: string,
  overrides: Record<string, unknown> = {},
) =>
  insertRow(db, "complaints", {
    flat_id: flatId,
    raised_by_id: raisedById,
    body: "Water leaking near the lift lobby",
    ...overrides,
  });

export const CLOSED_AT = "2026-04-02T10:00:00Z";
