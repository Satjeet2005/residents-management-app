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
  /** The resident's name; a unique one is made when not given (a name the matcher can use as a second signal). */
  name?: string;
  billAmountPaise?: bigint;
  /** The bill's due date; the bill is issued 9 days before it. */
  dueOn?: string;
  payments?: { date: string; amountPaise: bigint }[];
  /** LATE_FEE charges on the first bill, as the system posts them when the principal is paid (D110). */
  lateFees?: { date: string; amountPaise: bigint }[];
  secondBill?: { amountPaise: bigint; dueOn: string };
};
export type Resident = { user: { id: string; phone: string }; name: string; flatId: string; flatCode: string; billId: string; secondBillId: string | null };

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

  // Flat codes the matcher can read (T28 and a free floor and unit), so a test statement can name a flat the way a bank narration does.
  const taken = new Set((await owner.flat.findMany({ select: { code: true } })).map((f) => f.code));
  const free: string[] = [];
  for (let floor = 1; floor <= 16; floor++) for (let unit = 1; unit <= 8; unit++) free.push(`T28-${String(floor).padStart(2, "0")}${String(unit).padStart(2, "0")}`);
  const freeCodes = free.filter((code) => !taken.has(code));
  let residents = 0;
  const uniqueName = (n: number): string => {
    const letters = (value: number): string => (value === 0 ? "" : letters(Math.floor((value - 1) / 26)) + String.fromCharCode(97 + ((value - 1) % 26)));
    return `Tarun${letters(n)} Kasliwal${letters(n * 7 + 3)}`;
  };

  const makeResident = async (options: ResidentOptions = {}): Promise<Resident> => {
    const index = residents++;
    const code = freeCodes[index];
    if (code === undefined) throw new Error("the fixture ran out of free flat codes");
    const flat = await makeFlat(owner, code);
    const name = options.name ?? uniqueName(index + 1);
    const user = await makeUser(owner, { role: "RESIDENT", name });
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
    for (const [index, fee] of (options.lateFees ?? []).entries()) {
      await owner.ledgerEntry.create({
        data: { flatId: flat.id, billId, entryType: "LATE_FEE", direction: "CHARGE", amountPaise: fee.amountPaise, effectiveDate: new Date(`${fee.date}T00:00:00Z`), idempotencyKey: `test-late-fee:${billId}:${index}` },
      });
    }
    return { user, name, flatId: flat.id, flatCode: flat.code, billId, secondBillId };
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
