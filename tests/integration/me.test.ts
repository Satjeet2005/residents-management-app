import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { buildMe } from "@/server/auth/me";
import type { SessionUser } from "@/server/auth/session-service";
import { T0, addMember, makeFlat, makeUser, newPrisma } from "./auth-helpers";

let prisma: PrismaClient;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());

/** 2026-11-06 04:00 UTC is 09:30 in India, so "today" is 2026-11-06. */
const TODAY = "2026-11-06";

async function me(role: "RESIDENT" | "STAFF", permissions: string[] = [], now = T0) {
  const user = await makeUser(prisma, { role, permissions });
  const sessionUser: SessionUser = { id: user.id, name: "Test Person", phone: user.phone, role, active: true, permissions };
  return { user, read: () => buildMe(prisma, sessionUser, now) };
}

describe("me: buildMe", () => {
  it("a resident with one current flat gets that flat's code, no permissions and no phone", async () => {
    const { user, read } = await me("RESIDENT", ["payments:match"]);
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, "2020-01-01");
    const result = await read();
    expect(result).toEqual({ id: user.id, name: "Test Person", role: "RESIDENT", permissions: [], flats: [flat.code] });
    expect(JSON.stringify(result)).not.toContain(user.phone);
  });

  it("a membership that ended yesterday is not current", async () => {
    const { user, read } = await me("RESIDENT");
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, "2020-01-01", "2026-11-05");
    expect((await read()).flats).toEqual([]);
  });

  it("a membership that ends today still counts, and one that starts tomorrow does not", async () => {
    const { user, read } = await me("RESIDENT");
    const endsToday = await makeFlat(prisma);
    const startsTomorrow = await makeFlat(prisma);
    await addMember(prisma, endsToday.id, user.id, "2020-01-01", TODAY);
    await addMember(prisma, startsTomorrow.id, user.id, "2026-11-07");
    expect((await read()).flats).toEqual([endsToday.code]);
  });

  it("a membership that starts today counts", async () => {
    const { user, read } = await me("RESIDENT");
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, TODAY);
    expect((await read()).flats).toEqual([flat.code]);
  });

  it("today is the India date: 19:00 UTC on 6 November is already 7 November", async () => {
    const lateEvening = Date.UTC(2026, 10, 6, 19, 0, 0);
    const { user, read } = await me("RESIDENT", [], lateEvening);
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, user.id, "2026-11-07");
    expect((await read()).flats).toEqual([flat.code]);
  });

  it("two current memberships come back sorted, and the same flat twice appears once", async () => {
    const { user, read } = await me("RESIDENT");
    const b = await makeFlat(prisma, `ZB-${Date.now()}`);
    const a = await makeFlat(prisma, `ZA-${Date.now()}`);
    await addMember(prisma, b.id, user.id, "2020-01-01");
    await addMember(prisma, a.id, user.id, "2021-01-01");
    await addMember(prisma, a.id, user.id, "2022-01-01");
    expect((await read()).flats).toEqual([a.code, b.code]);
  });

  it("staff get their permissions, sorted, and no flats", async () => {
    const { user, read } = await me("STAFF", ["reports:view", "payments:match"]);
    expect(await read()).toEqual({ id: user.id, name: "Test Person", role: "STAFF", permissions: ["payments:match", "reports:view"], flats: [] });
  });

  it("another person's membership is not included", async () => {
    const { read } = await me("RESIDENT");
    const other = await makeUser(prisma);
    const flat = await makeFlat(prisma);
    await addMember(prisma, flat.id, other.id, "2020-01-01");
    expect((await read()).flats).toEqual([]);
  });
});
