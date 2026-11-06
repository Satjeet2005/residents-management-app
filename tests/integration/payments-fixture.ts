import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { inject } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { generateDemoDataset } from "@/domain/seed/generate";
import { addDays } from "@/domain/time/calendar";
import { dbPoolOptions } from "@/server/db-options";
import { createSession } from "@/server/auth/session-service";
import { writeDemoDataset } from "@/server/seed/writer";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { addMember, makeFlat, makeUser } from "./auth-helpers";
import { connect } from "./db";

/**
 * A scratch database with the demo data, and two Prisma clients on it: `app` logs in as the APP role (so every payment
 * query in a test runs with the real grants of the privilege matrix) and `owner` is for setting up and for checking.
 * `makeResident` adds a flat with one bill and optional payments, for a test that needs a flat of its own: the ledger is
 * append-only, so a test cannot clean up after itself and uses a new flat instead.
 */
export type PaymentsFixture = {
  app: PrismaClient;
  owner: PrismaClient;
  role: TestAppRole;
  scratchUrl: string;
  userByPhone: (phone: string) => Promise<{ id: string; name: string; phone: string; role: "RESIDENT" | "STAFF" }>;
  makeResident: (options?: ResidentOptions) => Promise<Resident>;
  signIn: (userId: string, role: "RESIDENT" | "STAFF", now: number) => Promise<string>;
  close: () => Promise<void>;
};

export type ResidentOptions = {
  billAmountPaise?: bigint;
  /** The bill's due date; the bill is issued 9 days before it. */
  dueOn?: string;
  payments?: { date: string; amountPaise: bigint }[];
  secondBill?: { amountPaise: bigint; dueOn: string };
};
export type Resident = { user: { id: string; phone: string }; flatId: string; flatCode: string; billId: string; secondBillId: string | null };

export async function createPaymentsFixture(): Promise<PaymentsFixture> {
  const admin = await connect();
  let scratchToDrop: string | null = null;
  try {
    return await build(admin, (name) => {
      scratchToDrop = name;
    });
  } catch (error) {
    if (scratchToDrop !== null) await admin.query(`DROP DATABASE IF EXISTS "${scratchToDrop}" WITH (FORCE)`);
    await admin.end();
    throw error;
  }
}

async function build(admin: Client, remember: (scratchName: string) => void): Promise<PaymentsFixture> {
  const scratchName = `township_test_pay_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${scratchName}"`);
  remember(scratchName);
  const url = new URL(inject("testDatabaseUrl"));
  url.pathname = `/${scratchName}`;
  const scratchUrl = url.toString();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: scratchUrl }, stdio: "pipe" });
  const ownerClient = new Client({ connectionString: scratchUrl });
  await ownerClient.connect();
  await writeDemoDataset(ownerClient, generateDemoDataset());
  const role = await createAppRole(ownerClient, scratchUrl);
  const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
  const app = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "10" }) }) });

  const makeResident = async (options: ResidentOptions = {}): Promise<Resident> => {
    const flat = await makeFlat(owner);
    const user = await makeUser(owner, { role: "RESIDENT", name: "Test Resident" });
    await addMember(owner, flat.id, user.id, "2026-01-01");
    const addBill = async (amountPaise: bigint, dueOn: string): Promise<string> => {
      const issuedOn = addDays(dueOn, -9);
      const bill = await owner.bill.create({
        data: { flatId: flat.id, period: new Date(`${issuedOn.slice(0, 7)}-01T00:00:00Z`), issuedOn: new Date(`${issuedOn}T00:00:00Z`), dueOn: new Date(`${dueOn}T00:00:00Z`), amountPaise, areaSqftSnapshot: 1000, ratePaisePerSqft: 100 },
      });
      await owner.ledgerEntry.create({
        data: { flatId: flat.id, billId: bill.id, entryType: "BILL", direction: "CHARGE", amountPaise, effectiveDate: new Date(`${issuedOn}T00:00:00Z`), idempotencyKey: `test-bill:${bill.id}` },
      });
      return bill.id;
    };
    const billId = await addBill(options.billAmountPaise ?? 637_000n, options.dueOn ?? "2026-09-10");
    const secondBillId = options.secondBill === undefined ? null : await addBill(options.secondBill.amountPaise, options.secondBill.dueOn);
    for (const [index, payment] of (options.payments ?? []).entries()) {
      await owner.ledgerEntry.create({
        data: { flatId: flat.id, billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: payment.amountPaise, effectiveDate: new Date(`${payment.date}T00:00:00Z`), idempotencyKey: `test-payment:${billId}:${index}` },
      });
    }
    return { user, flatId: flat.id, flatCode: flat.code, billId, secondBillId };
  };

  return {
    app,
    owner,
    role,
    scratchUrl,
    userByPhone: (phone) => owner.user.findUniqueOrThrow({ where: { phone }, select: { id: true, name: true, phone: true, role: true } }),
    makeResident,
    signIn: async (userId, userRole, now) => `session=${(await createSession(app, { id: userId, role: userRole }, now)).token}`,
    close: async () => {
      await app.$disconnect();
      await owner.$disconnect();
      await ownerClient.end();
      await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await role.drop();
      await admin.end();
    },
  };
}
