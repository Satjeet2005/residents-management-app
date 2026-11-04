import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { generateDemoDataset } from "@/domain/seed/generate";
import { DEMO_AS_OF, type DemoDataset } from "@/domain/seed/types";
import { buildSeedTables } from "@/server/seed/rows";
import { seedDemoDatabase } from "@/server/seed/run";
import { SeedWriteError, writeDemoDataset } from "@/server/seed/writer";
import { SQLSTATE, connect, rejectedWith } from "./db";

/**
 * The shared test database already holds rows from the other integration files,
 * and the seed needs an empty one, so this file makes its own databases.
 */
async function createScratchDatabase(): Promise<{ db: Client; drop: () => Promise<void> }> {
  const admin = await connect();
  const name = `township_seed_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(inject("testDatabaseUrl"));
  url.pathname = `/${name}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  return {
    db,
    drop: async () => {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

const dataset = generateDemoDataset();
const tableNames = buildSeedTables(dataset).map((t) => t.table);

async function countRows(db: Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tableNames) counts[table] = (await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
  return counts;
}

/** What a flat owes as of the demo date, rebuilt from the database only: its bills, its ledger entries and computeLateFee. */
async function amountDueFromDatabase(db: Client, code: string) {
  const bills = await db.query(
    `SELECT b.id, to_char(b.due_on, 'YYYY-MM-DD') AS due_on, b.amount_paise::text AS amount, to_char(b.period, 'YYYY-MM-DD') AS period
       FROM bills b JOIN flats f ON f.id = b.flat_id WHERE f.code = $1 ORDER BY b.period`,
    [code],
  );
  const open: { period: string; outstanding: bigint; fee: bigint; overdueDays: number }[] = [];
  for (const bill of bills.rows) {
    const payments = await db.query(
      `SELECT to_char(effective_date, 'YYYY-MM-DD') AS date, amount_paise::text AS amount
         FROM ledger_entries WHERE bill_id = $1 AND entry_type = 'PAYMENT'`,
      [bill.id],
    );
    const result = computeLateFee({
      billAmountPaise: BigInt(bill.amount),
      dueOn: bill.due_on,
      asOf: DEMO_AS_OF,
      payments: payments.rows.map((p) => ({ date: p.date, amountPaise: BigInt(p.amount) })),
      holds: [],
      policy: defaultLateFeePolicy,
    });
    if (result.outstandingPaise > 0n) open.push({ period: bill.period, outstanding: result.outstandingPaise, fee: result.feePaise, overdueDays: result.overdueDays });
  }
  return { open, amountDue: open.reduce((sum, o) => sum + o.outstanding + o.fee, 0n) };
}

describe("W2 seeding a fresh database", () => {
  let db: Client;
  let drop: () => Promise<void>;
  let seeded: Awaited<ReturnType<typeof seedDemoDatabase>>;
  let seedStartedAt: number;

  beforeAll(async () => {
    ({ db, drop } = await createScratchDatabase());
    seedStartedAt = Date.now();
    seeded = await seedDemoDatabase(db, dataset);
  });
  afterAll(() => drop());

  it("W2 writes the dataset: every table's row count equals the dataset's", async () => {
    expect(seeded.ok).toBe(true);
    const expected: Record<string, number> = {};
    for (const t of buildSeedTables(dataset)) expected[t.table] = t.rows.length;
    expect(await countRows(db)).toEqual(expected);
    expect(seeded.ok && seeded.counts).toEqual(expected);
  });

  it("W2 amounts due rebuilt from the database: T12-0408 646800, T21-1601 569800, T07-1203 0", async () => {
    expect((await amountDueFromDatabase(db, "T12-0408")).amountDue).toBe(646800n);
    expect((await amountDueFromDatabase(db, "T21-1601")).amountDue).toBe(569800n);
    expect((await amountDueFromDatabase(db, "T07-1203")).amountDue).toBe(0n);
  });

  it("W2 T15-0902 has two unpaid bills, and the three 1,640 sq ft flats owe 1066000 plus the fee", async () => {
    const t15 = await amountDueFromDatabase(db, "T15-0902");
    expect(t15.open.map((o) => [o.period, o.overdueDays])).toEqual([["2026-09-01", 47], ["2026-10-01", 17]]);
    expect(t15.amountDue).toBe(1_734_100n);
    for (const code of ["T03-0702", "T18-1105", "T26-0301"]) {
      const { open, amountDue } = await amountDueFromDatabase(db, code);
      expect(open, code).toHaveLength(1);
      expect(open[0].fee, code).toBeGreaterThan(0n);
      expect(amountDue, code).toBe(1_066_000n + open[0].fee);
      expect(amountDue, code).toBe(1_072_000n);
    }
  });

  it("W2 a second run is refused by the guard and changes no count", async () => {
    const before = await countRows(db);
    const again = await seedDemoDatabase(db, dataset);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toContain("npm run db:reset-demo");
    expect(await countRows(db)).toEqual(before);
  });

  it("W2 the append-only triggers still reject UPDATE on ledger_entries and complaint_events", async () => {
    await rejectedWith(db.query("UPDATE ledger_entries SET amount_paise = 1"), SQLSTATE.restrictViolation);
    await rejectedWith(db.query("UPDATE complaint_events SET payload = '{}'"), SQLSTATE.restrictViolation);
    await rejectedWith(db.query("UPDATE classifications SET urgency = 'LOW'"), SQLSTATE.restrictViolation);
  });

  it("W2 the seed no longer stamps now: ledger and known-payer created_at are older than the seed run", async () => {
    const ledger = await db.query("SELECT max(created_at) AS last FROM ledger_entries");
    expect(ledger.rows[0].last.getTime()).toBeLessThan(seedStartedAt);
    expect(ledger.rows[0].last.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 9, 27, 6, 30));
    const payers = await db.query("SELECT max(created_at) AS last FROM known_payers");
    expect(payers.rows[0].last.getTime()).toBeLessThan(seedStartedAt);
  });

  it("W2 timestamps are the dataset's, not the time of the seed", async () => {
    const { rows } = await db.query("SELECT min(created_at) AS first, max(created_at) AS last FROM complaints");
    expect(rows[0].first.getTime()).toBe(Math.min(...dataset.complaints.map((c) => c.createdAt)));
    expect(rows[0].last.getTime()).toBe(Math.max(...dataset.complaints.map((c) => c.createdAt)));
    const events = await db.query("SELECT max(created_at) AS last FROM complaint_events");
    expect(events.rows[0].last.getTime()).toBe(Math.max(...dataset.events.map((e) => e.createdAt)));
  });
});

describe("W3 a bad row aborts everything", () => {
  let db: Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await createScratchDatabase());
  });
  afterAll(() => drop());

  it("W3 a bill with amount 0 rolls back every table and names the table, row and constraint", async () => {
    const broken: DemoDataset = structuredClone(dataset);
    broken.bills[1500].amountPaise = 0n;
    const failure = await writeDemoDataset(db, broken).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(SeedWriteError);
    const error = failure as SeedWriteError;
    expect([error.table, error.rowKey, error.constraint]).toEqual(["bills", broken.bills[1500].key, "bills_amount_paise_positive"]);
    expect(error.message).toContain("bills_amount_paise_positive");
    const counts = await countRows(db);
    for (const [table, n] of Object.entries(counts)) expect(n, table).toBe(0);
  });
});
