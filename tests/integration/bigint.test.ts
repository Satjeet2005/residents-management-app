import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { connect, insertFlat } from "./db";

const OVER_INT32 = 2_160_000_000n;
const INT64_MAX = 9_223_372_036_854_775_807n;

let db: Client;
let prisma: PrismaClient;
let flatId: string;

beforeAll(async () => {
  db = await connect();
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: inject("testDatabaseUrl") }) });
  flatId = await insertFlat(db);
});
afterAll(async () => {
  await prisma.$disconnect();
  await db.end();
});

describe("BIGINT paise round-trip without loss", () => {
  it.each([OVER_INT32, INT64_MAX])("%s written by raw SQL is read back exactly by Prisma", async (amount) => {
    const { rows } = await db.query(
      `INSERT INTO ledger_entries (flat_id, entry_type, direction, amount_paise, effective_date, idempotency_key)
       VALUES ($1, 'BILL', 'CHARGE', $2::bigint, '2026-04-01', $3) RETURNING id`,
      [flatId, amount.toString(), randomUUID()],
    );
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(entry.amountPaise).toBe(amount);
    expect(typeof entry.amountPaise).toBe("bigint");
  });

  it.each([OVER_INT32, INT64_MAX])("%s written by Prisma is read back exactly by raw SQL", async (amount) => {
    const entry = await prisma.ledgerEntry.create({
      data: {
        flatId,
        entryType: "BILL",
        direction: "CHARGE",
        amountPaise: amount,
        effectiveDate: new Date("2026-04-01"),
        idempotencyKey: randomUUID(),
      },
    });
    const { rows } = await db.query("SELECT amount_paise::text AS amount FROM ledger_entries WHERE id = $1", [entry.id]);
    expect(rows[0].amount).toBe(amount.toString());
  });
});
