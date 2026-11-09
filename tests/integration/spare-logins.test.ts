import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessNow } from "@/server/clock";
import { getHomeData } from "@/server/home/home-data";
import type { HomeData } from "@/server/home/types";
import { initiatePayment } from "@/server/payments/initiate";
import { completeMockPayment } from "@/server/payments/mock-checkout";
import { importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { type SeededWorld, setupSeededWorld } from "./seeded-world";
import { SPARE_LOGINS } from "./spare-logins-data";

/**
 * D233: the spare demo logins, on the whole seeded demo database at the demo date. Each one sees one open October bill and a payable amount; the sample
 * statement does not touch their flats; paying one changes nothing for the three sample flats or for the other spares.
 */
const ENV = { DEMO_MODE: "true", DEMO_AS_OF: "2026-10-27", PAYMENT_WEBHOOK_SECRET: "spare-logins-secret-0123456789abcdef", NODE_ENV: "test" };
const SAMPLE_PHONES = { "T07-1203": "5000000006", "T12-0408": "5000000007", "T21-1601": "5000000009" };
let world: SeededWorld;
beforeAll(async () => {
  world = await setupSeededWorld();
}, 240_000);
afterAll(async () => {
  await world?.close();
});

const now = () => businessNow(ENV);
const userOf = (phone: string) => world.ownerPrisma.user.findUniqueOrThrow({ where: { phone }, select: { id: true, name: true, phone: true, role: true } });
async function home(phone: string): Promise<Extract<HomeData, { kind: "OK" }>> {
  const data = await getHomeData({ db: world.appPrisma, user: await userOf(phone), now: now() });
  if (data.kind !== "OK") throw new Error(`no flat for ${phone}`);
  return data;
}
const dueOf = async (phone: string) => (await home(phone)).dues.amountDuePaise;
const allPhones = [...SPARE_LOGINS.map((s) => s.phone), ...Object.values(SAMPLE_PHONES)];
const snapshot = async () => Object.fromEntries(await Promise.all(allPhones.map(async (phone) => [phone, (await dueOf(phone)).toString()])));

describe("D233 spare demo logins at the demo date", () => {
  it.each(SPARE_LOGINS)("$phone sees $flatCode with one open October bill, a payable amount, and no complaint", async ({ phone, flatCode, dueRupees, amountDueRupees }) => {
    const data = await home(phone);
    expect(data.flat.code).toBe(flatCode);
    expect(data.dues.openBills).toHaveLength(1);
    expect(data.dues.openBills[0].outstandingPaise).toBe(BigInt(dueRupees) * 100n);
    expect(data.dues.amountDuePaise).toBe(BigInt(amountDueRupees) * 100n);
    expect(data.dues.oldest?.overdueDays).toBe(17);
    expect(data.dues.status).toBe("OVERDUE");
    expect(data.complaint).toBeNull();
  });

  it("the sample statement does not touch the spare flats: no bank row, no new ledger entry", async () => {
    const flats = await world.ownerPrisma.flat.findMany({ where: { code: { in: SPARE_LOGINS.map((s) => s.flatCode) } }, select: { id: true } });
    const ledgerBefore = await world.ownerPrisma.ledgerEntry.count({ where: { flatId: { in: flats.map((f) => f.id) } } });
    const priya = await userOf("5000000001");
    const result = await importStatement({ db: world.appPrisma, user: { id: priya.id }, filename: "sample-statement.csv", csvText: getSampleStatement(), now: now() });
    expect(result.status).toBe("IMPORTED");
    expect(await world.ownerPrisma.ledgerEntry.count({ where: { flatId: { in: flats.map((f) => f.id) } } })).toBe(ledgerBefore);
    expect(await world.ownerPrisma.bankRow.count({ where: { flatId: { in: flats.map((f) => f.id) } } })).toBe(0);
  });

  it("paying one spare bill leaves the three sample flats and the other seven spares exactly as they were", async () => {
    const before = await snapshot();
    const payer = SPARE_LOGINS[0];
    const user = await userOf(payer.phone);
    const started = await initiatePayment({ db: world.appPrisma, user, expectedAmountPaise: before[payer.phone] === undefined ? 0n : BigInt(before[payer.phone]), now: now() });
    expect(started.status).toBe("CREATED");
    if (started.status !== "CREATED") return;
    await completeMockPayment({ db: world.appPrisma, user, attemptId: started.attemptId, outcome: "SUCCESS", now: now(), env: ENV });
    const after = await snapshot();
    expect(after[payer.phone]).toBe("0");
    for (const phone of allPhones.filter((p) => p !== payer.phone)) expect(after[phone], phone).toBe(before[phone]);
    expect((await home(payer.phone)).dues.status).toBe("ALL_PAID");
  });
});
