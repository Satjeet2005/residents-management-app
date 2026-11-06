import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { computeDues } from "@/domain/billing/dues";
import { generateDemoDataset } from "@/domain/seed/generate";
import { DEMO_NOW } from "@/domain/seed/types";
import { diffDays, istDateOf } from "@/domain/time/calendar";
import { dbPoolOptions } from "@/server/db-options";
import { getHomeData } from "@/server/home/home-data";
import { calendarDateOf } from "@/server/home/mapper";
import type { HomeData } from "@/server/home/types";
import { getProfileData } from "@/server/profile/profile-data";
import { writeDemoDataset } from "@/server/seed/writer";
import { connect } from "./db";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { addMember, makeFlat, makeUser } from "./auth-helpers";

/**
 * HM6: the resident Home against a freshly seeded database, through a Prisma client that logs in as the APP role (not the
 * owner), so every query here runs with the SELECT grants of the matrix and no new privilege. The clock is injected at
 * 27 Oct 2026, 12:00 India time, so the numbers are exact.
 */
let admin: Client;
let scratchName: string;
let scratchUrl: string;
let ownerClient: Client;
let ownerPrisma: PrismaClient;
let appPrisma: PrismaClient;
let role: TestAppRole;

const userByPhone = async (phone: string) => {
  const user = await ownerPrisma.user.findUniqueOrThrow({ where: { phone }, select: { id: true, name: true, phone: true, role: true } });
  return user;
};
const homeFor = (phone: string, now = DEMO_NOW) => userByPhone(phone).then((user) => getHomeData({ db: appPrisma, user, now }));
const ok = (data: HomeData) => {
  if (data.kind !== "OK") throw new Error(`expected OK, got ${data.kind}`);
  return data;
};
const asText = (data: unknown) => JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

beforeAll(async () => {
  admin = await connect();
  scratchName = `township_home_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${scratchName}"`);
  const url = new URL(inject("testDatabaseUrl"));
  url.pathname = `/${scratchName}`;
  scratchUrl = url.toString();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: scratchUrl }, stdio: "pipe" });
  ownerClient = new Client({ connectionString: scratchUrl });
  await ownerClient.connect();
  await writeDemoDataset(ownerClient, generateDemoDataset());
  role = await createAppRole(ownerClient, scratchUrl);
  ownerPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
  appPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "4" }) }) });
}, 120_000);

afterAll(async () => {
  await appPrisma?.$disconnect();
  await ownerPrisma?.$disconnect();
  await ownerClient?.end();
  if (admin && scratchName) await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  if (role) await role.drop();
  await admin?.end();
}, 60_000);

describe("HM6 the connection is the app role, not the owner", () => {
  it("HM6 the queries run as a role that has no UPDATE on the ledger, bills or complaints", async () => {
    const who = await appPrisma.$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
    expect(who[0].user).toBe(role.name);
    await expect(appPrisma.$executeRaw`UPDATE bills SET amount_paise = 1`).rejects.toThrow(/permission denied/i);
    await expect(appPrisma.$executeRaw`UPDATE complaints SET status = 'CLOSED'`).rejects.toThrow(/permission denied/i);
    await expect(appPrisma.$executeRaw`DELETE FROM ledger_entries`).rejects.toThrow(/permission denied/i);
  });
});

describe("HM6 getHomeData for the sample residents (27 Oct 2026, 12:00 IST)", () => {
  it("HM6 T12-0408 (Swati Joshi, 5000000007): ₹6,468, 47 days overdue, the water-leak complaint, two visitors", async () => {
    const data = ok(await homeFor("5000000007"));
    expect(data.flat.code).toBe("T12-0408");
    expect(data.dues.status).toBe("OVERDUE");
    expect(data.dues.amountDuePaise).toBe(646_800n);
    expect(data.dues.oldest).toMatchObject({ dueOn: "2026-09-10", overdueDays: 47 });
    expect(data.dues.openBills[0]).toMatchObject({ outstandingPaise: 637_000n, feePaise: 9_800n });
    expect(data.complaint).toMatchObject({ title: "Water leak under the kitchen sink", status: "ASSIGNED", current: 1 });
    expect(data.complaint?.reply).toMatchObject({ kind: "DUE", today: true });
    expect(data.visitors).toHaveLength(2);
    expect(Object.keys(data.visitors[0])).toEqual(["expectedAt"]);
    expect(asText(data)).not.toMatch(/Ramesh|Anita/);
    expect(data.recent[0]).toEqual({ entryType: "BILL", date: "2026-09-01", amountPaise: 637_000n });
    expect(data.emergency).toEqual({ dutyManagerPhone: "5900000001", emergencyServicesPhone: null });
    expect(data.hasActivity).toBe(true);
  });

  it("HM6 T21-1601 (Aamir Shaikh, 5000000009): ₹5,698 with ₹5,000 paid on 12 Oct and no complaint", async () => {
    const data = ok(await homeFor("5000000009"));
    expect(data.flat.code).toBe("T21-1601");
    expect(data.dues.status).toBe("PARTLY_PAID");
    expect(data.dues.amountDuePaise).toBe(569_800n);
    expect(data.dues.partlyPaid).toEqual({ paidPaise: 500_000n, lastPaidOn: "2026-10-12", stillDuePaise: 566_000n, feePaise: 3_800n });
    expect(data.complaint).toBeNull();
  });

  it("HM6 T07-1203 (Neeraj Kulkarni, 5000000006): no dues, last payment ₹7,475 on 3 Oct, a complaint waiting for his answer", async () => {
    const data = ok(await homeFor("5000000006"));
    expect(data.flat.code).toBe("T07-1203");
    expect(data.dues.status).toBe("ALL_PAID");
    expect(data.dues.lastPayment).toEqual({ amountPaise: 747_500n, date: "2026-10-03" });
    expect(data.complaint).toMatchObject({ status: "PENDING_CONFIRMATION", current: 3, needsAnswer: true, reply: null });
    expect(data.visitors).toEqual([]);
  });

  it("HM6 T15-0902 (Rohit Deshmukh, 5000000010): two open bills, ₹17,341 in all, and a NEW complaint", async () => {
    const data = ok(await homeFor("5000000010"));
    expect(data.flat.code).toBe("T15-0902");
    expect(data.dues.openBills.map((b) => b.overdueDays)).toEqual([47, 17]);
    expect(data.dues.amountDuePaise).toBe(1_734_100n);
    expect(data.complaint).toMatchObject({ status: "NEW", current: 0 });
  });

  it.each(["T03-0702", "T18-1105", "T26-0301"])("HM6 %s, one of the three look-alike flats: ₹10,720 due", async (code) => {
    const member = await ownerPrisma.flatMember.findFirstOrThrow({ where: { flat: { code } }, select: { user: { select: { phone: true } } } });
    const data = ok(await homeFor(member.user.phone));
    expect(data.flat.code).toBe(code);
    expect(data.dues.amountDuePaise).toBe(1_072_000n);
  });
});

describe("HM6 one resident never sees another flat's data", () => {
  it("HM6 Neeraj (T07-1203) gets nothing of T12-0408, and Swati (T12-0408) nothing of T07-1203", async () => {
    const neeraj = asText(await homeFor("5000000006"));
    const swati = asText(await homeFor("5000000007"));
    for (const secret of ["T12-0408", "Water leak", "Swati", "Anil", "Ramesh Gupta", "Anita Singh", "646800"]) expect(neeraj, `Neeraj sees ${secret}`).not.toContain(secret);
    for (const secret of ["T07-1203", "Corridor light", "Neeraj", "747500"]) expect(swati, `Swati sees ${secret}`).not.toContain(secret);
  });

  it("HM6 two residents of the same flat see the same flat's data, and nobody else's", async () => {
    const swati = ok(await homeFor("5000000007"));
    const anil = ok(await homeFor("5000000008"));
    expect(anil.flat.code).toBe("T12-0408");
    expect(anil.dues.amountDuePaise).toBe(swati.dues.amountDuePaise);
    expect(anil.complaint?.title).toBe(swati.complaint?.title);
  });

  it("HM6 getHomeData takes no flat from outside: its only inputs are the database, the user and the time", () => {
    expect(getHomeData.length).toBe(1);
  });
});

describe("HM6 membership dates", () => {
  const person = async (startsOn: string, endsOn: string | null) => {
    const user = await makeUser(ownerPrisma, { role: "RESIDENT" });
    const flat = await makeFlat(ownerPrisma);
    await addMember(ownerPrisma, flat.id, user.id, startsOn, endsOn);
    return { id: user.id, name: "Test Person", flat };
  };

  it("HM6 a membership that ended yesterday gives NO_FLAT", async () => {
    const p = await person("2020-01-01", "2026-10-26");
    expect(await getHomeData({ db: appPrisma, user: p, now: DEMO_NOW })).toEqual({ kind: "NO_FLAT", userName: "Test Person", asOf: "2026-10-27" });
  });

  it("HM6 a membership that ends today still counts, one that starts tomorrow does not", async () => {
    const endsToday = await person("2020-01-01", "2026-10-27");
    expect(ok(await getHomeData({ db: appPrisma, user: endsToday, now: DEMO_NOW })).flat.code).toBe(endsToday.flat.code);
    const startsTomorrow = await person("2026-10-28", null);
    expect((await getHomeData({ db: appPrisma, user: startsTomorrow, now: DEMO_NOW })).kind).toBe("NO_FLAT");
  });

  it("HM6 a flat with no bills and no entries is a first-run home: no dues, no activity", async () => {
    const p = await person("2020-01-01", null);
    const data = ok(await getHomeData({ db: appPrisma, user: p, now: DEMO_NOW }));
    expect(data.dues.status).toBe("ALL_PAID");
    expect(data.hasActivity).toBe(false);
    expect(data.recent).toEqual([]);
    expect(data.complaint).toBeNull();
  });
});

describe("HM6 the business clock moves the numbers (a later real date)", () => {
  it("HM6 on 6 Nov 2026 T12-0408 is 57 days overdue, and the amount equals an independent BigInt computation", async () => {
    const now = Date.UTC(2026, 10, 6, 6, 30);
    const data = ok(await homeFor("5000000007", now));
    expect(data.asOf).toBe("2026-11-06");
    expect(data.dues.oldest?.overdueDays).toBe(57);
    const numerator = 637_000n * 1200n * 57n;
    const fee = ((2n * numerator + 3_650_000n * 100n) / (2n * 3_650_000n * 100n)) * 100n;
    expect(data.dues.amountDuePaise).toBe(637_000n + fee);
    expect(diffDays("2026-09-10", "2026-11-06")).toBe(57);
  });

  it("HM6 the visitors of 27 Oct are not 'today' on 6 Nov, and the reply is overdue", async () => {
    const data = ok(await homeFor("5000000007", Date.UTC(2026, 10, 6, 6, 30)));
    expect(data.visitors).toEqual([]);
    expect(data.complaint?.reply).toEqual({ kind: "OVERDUE" });
  });
});

describe("HM6 every seeded flat: no money is owed outside an open bill", () => {
  it("HM6 for all flats, a flat with no open bill has a ledger balance of zero or less (so 'No dues' is true)", async () => {
    const [bills, entries] = await Promise.all([
      ownerPrisma.bill.findMany({ select: { id: true, flatId: true, period: true, issuedOn: true, dueOn: true, amountPaise: true } }),
      ownerPrisma.ledgerEntry.findMany({ select: { id: true, flatId: true, entryType: true, direction: true, amountPaise: true, effectiveDate: true, billId: true, reversesEntryId: true } }),
    ]);
    const policy = { annualRateBps: 1200, capBps: 2100, daysInYear: 365 };
    const today = istDateOf(DEMO_NOW);
    const billsByFlat = Map.groupBy(bills, (b) => b.flatId);
    const entriesByFlat = Map.groupBy(entries, (e) => e.flatId);
    const flats = await ownerPrisma.flat.findMany({ select: { id: true } });
    let open = 0;
    const problems: string[] = [];
    for (const { id } of flats) {
      const dues = computeDues({
        bills: (billsByFlat.get(id) ?? []).map((b) => ({ id: b.id, period: calendarDateOf(b.period), issuedOn: calendarDateOf(b.issuedOn), dueOn: calendarDateOf(b.dueOn), amountPaise: b.amountPaise })),
        entries: (entriesByFlat.get(id) ?? []).map((e) => ({ ...e, effectiveDate: calendarDateOf(e.effectiveDate) })),
        policy,
        today,
      });
      if (dues.openBills.length > 0) open++;
      else if (dues.balancePaise > 0n) problems.push(`${id}: no open bill but balance ${dues.balancePaise}`);
    }
    expect(flats.length).toBeGreaterThanOrEqual(2400);
    expect(open).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

describe("HM6 the profile", () => {
  it("HM6 Swati's profile: her name, masked phone, role and her flat with the relation", async () => {
    const user = await userByPhone("5000000007");
    const profile = await getProfileData({ db: appPrisma, user, now: DEMO_NOW });
    expect(profile).toEqual({ name: "Swati Joshi", phoneMasked: "******0007", role: "RESIDENT", flats: [{ code: "T12-0408", relation: "TENANT" }] });
  });

  it("HM6 a member of the same flat is the owner there, and a person with no flat has an empty list", async () => {
    const anil = await getProfileData({ db: appPrisma, user: await userByPhone("5000000008"), now: DEMO_NOW });
    expect(anil.flats).toEqual([{ code: "T12-0408", relation: "OWNER" }]);
    const staff = await getProfileData({ db: appPrisma, user: await userByPhone("5000000001"), now: DEMO_NOW });
    expect(staff).toMatchObject({ role: "STAFF", flats: [] });
  });
});
