import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { StaffAccessError, loadImportList } from "@/server/statements/ui-data";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { newStaff, seedStaff } from "./reconciliation-helpers";
import { csv } from "./statements-helpers";

/** T12c: the data the staff screens read, loaded through the APP role (the privilege-limited login), for the people who may and may not. */
let fx: PaymentsFixture;
let sampleImportId: string;
let priya: Awaited<ReturnType<typeof seedStaff>>;
let rahul: Awaited<ReturnType<typeof seedStaff>>;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  priya = await seedStaff(fx, "5000000001");
  rahul = await seedStaff(fx, "5000000002");
  const result = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "sample-statement.csv", csvText: getSampleStatement(), now: DEMO_NOW });
  if (result.status !== "IMPORTED") throw new Error(result.status);
  sampleImportId = result.importId;
}, 180_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

describe("UD1 the data runs as the app role", () => {
  it("the client the loaders use is the privilege-limited login, not the owner", async () => {
    const who = await fx.app.$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
    expect(who[0].user).toBe(fx.role.name);
  });
});

describe("UD2 the recent imports", () => {
  it("lists the sample first, with its counts read from the database and the books accounted for", async () => {
    const list = await loadImportList({ db: fx.app, user: priya });
    expect(list[0]).toEqual({ importId: sampleImportId, filename: "sample-statement.csv", uploadedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), rowsRead: 106, posted: 25, needsYou: 43, awaitingApproval: 0, ignored: 38, accounted: true });
  });

  it("is newest first and at most 10, and a second import with a bad count says the books do not add up", async () => {
    const small = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "second.csv", csvText: csv("2026-10-26,CASH DEPOSIT,10.00,", "2026-10-26,SMS CHARGES,,5.00"), now: DEMO_NOW });
    if (small.status !== "IMPORTED") throw new Error(small.status);
    let list = await loadImportList({ db: fx.app, user: rahul });
    expect(list.map((e) => e.filename).slice(0, 2)).toEqual(["second.csv", "sample-statement.csv"]);
    expect(list[0]).toMatchObject({ rowsRead: 2, needsYou: 1, ignored: 1, posted: 0, accounted: true });
    await fx.owner.$executeRaw`UPDATE statement_imports SET rows_read = rows_read + 1 WHERE id = ${small.importId}::uuid`;
    list = await loadImportList({ db: fx.app, user: rahul });
    expect(list[0]).toMatchObject({ filename: "second.csv", accounted: false });
    expect(list.length).toBeLessThanOrEqual(10);
  });
});

describe("UD3 who can load it", () => {
  it("a resident cannot", async () => {
    const resident = await fx.makeResident();
    await expect(loadImportList({ db: fx.app, user: { id: resident.user.id, role: "RESIDENT", active: true, permissions: ["payments:match"] } })).rejects.toBeInstanceOf(StaffAccessError);
  });

  it("staff without payments:match cannot (payments:approve alone is not enough, nor reports:view)", async () => {
    for (const permissions of [["reports:view"], ["payments:approve"], []]) {
      const other = await newStaff(fx, permissions);
      await expect(loadImportList({ db: fx.app, user: other })).rejects.toBeInstanceOf(StaffAccessError);
    }
  });

  it("an inactive staff user cannot", async () => {
    await expect(loadImportList({ db: fx.app, user: { ...priya, active: false } })).rejects.toBeInstanceOf(StaffAccessError);
  });
});
