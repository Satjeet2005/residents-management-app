import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { PAGE_SIZE, StaffAccessError, loadImportList, loadRowCards, loadWorkspace } from "@/server/statements/ui-data";
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

describe("UD4 the workspace of the sample import", () => {
  it("the header, the counts read back from the database, and the lane counts agree with the rows stored", async () => {
    const data = await loadWorkspace({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU" });
    expect(data).not.toBeNull();
    expect(data?.header).toMatchObject({ importId: sampleImportId, filename: "sample-statement.csv", uploadedBy: "Priya Nair" });
    expect(data?.counts).toEqual({ rowsRead: 106, autoMatched: 25, manuallyMatched: 0, needsYou: 43, awaitingApproval: 0, notMaintenance: 38, alreadyImported: 0, invalidRows: 0, accounted: true });
    expect(data?.laneCounts).toEqual({ NEEDS_YOU: 43, AWAITING_APPROVAL: 0, MATCHED: 25, NOT_MAINTENANCE: 38 });
    const stored = await fx.owner.bankRow.groupBy({ by: ["state"], where: { importId: sampleImportId }, _count: { _all: true } });
    expect(Object.fromEntries(stored.map((r) => [r.state, r._count._all]))).toEqual({ AUTO_MATCHED: 25, QUEUED: 43, IGNORED: 38 });
  });

  it("each lane holds the rows of its states: Needs you is the QUEUED rows, Posted the AUTO_MATCHED ones, Not maintenance the IGNORED ones", async () => {
    const expected = { NEEDS_YOU: "QUEUED", MATCHED: "AUTO_MATCHED", NOT_MAINTENANCE: "IGNORED", AWAITING_APPROVAL: "AWAITING_APPROVAL" } as const;
    for (const lane of ["NEEDS_YOU", "MATCHED", "NOT_MAINTENANCE", "AWAITING_APPROVAL"] as const) {
      const cards = await loadRowCards({ db: fx.app, user: priya, importId: sampleImportId, lane });
      expect(cards?.rows.every((r) => r.state === expected[lane]), lane).toBe(true);
    }
  });

  it("the first page of Needs you is 25 rows, biggest amount first, and Load more gives the other 18 with no overlap", async () => {
    const first = await loadRowCards({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU" });
    expect(PAGE_SIZE).toBe(25);
    expect(first?.rows).toHaveLength(25);
    expect(first?.nextCursor).not.toBeNull();
    const second = await loadRowCards({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU", cursor: first?.nextCursor ?? undefined });
    expect(second?.rows).toHaveLength(18);
    expect(second?.nextCursor).toBeNull();
    const all = [...(first?.rows ?? []), ...(second?.rows ?? [])];
    expect(new Set(all.map((r) => r.id)).size).toBe(43);
    expect(all.every((r, i) => i === 0 || BigInt(all[i - 1].amountPaise) >= BigInt(r.amountPaise))).toBe(true);
  });

  it("a row carries the best candidate flat and the confidence the matcher stored: the principal-only payment of T21-1601 is Medium", async () => {
    const first = await loadRowCards({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU" });
    const second = await loadRowCards({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU", cursor: first?.nextCursor ?? undefined });
    const all = [...(first?.rows ?? []), ...(second?.rows ?? [])];
    const row = all.find((r) => r.narration.includes("710000000003"));
    expect(row).toMatchObject({ bestFlat: "T21-1601", confidence: "MEDIUM", amountPaise: "566000", direction: "CREDIT", version: 1 });
    const anonymous = all.find((r) => r.narration.includes("710000000004"));
    expect(anonymous).toMatchObject({ confidence: "LOW" });
  });

  it("an id that is not an import, or not an id, is null", async () => {
    expect(await loadWorkspace({ db: fx.app, user: priya, importId: crypto.randomUUID(), lane: "NEEDS_YOU" })).toBeNull();
    expect(await loadWorkspace({ db: fx.app, user: priya, importId: "not-an-id", lane: "NEEDS_YOU" })).toBeNull();
    expect(await loadRowCards({ db: fx.app, user: priya, importId: crypto.randomUUID(), lane: "NEEDS_YOU" })).toBeNull();
  });

  it("a resident, and staff without payments:match, cannot load the workspace or a page of rows", async () => {
    const resident = await fx.makeResident();
    const reports = await newStaff(fx, ["reports:view"]);
    const asResident = { id: resident.user.id, role: "RESIDENT" as const, active: true, permissions: ["payments:match"] };
    for (const user of [asResident, reports]) {
      await expect(loadWorkspace({ db: fx.app, user, importId: sampleImportId, lane: "NEEDS_YOU" })).rejects.toBeInstanceOf(StaffAccessError);
      await expect(loadRowCards({ db: fx.app, user, importId: sampleImportId, lane: "MATCHED" })).rejects.toBeInstanceOf(StaffAccessError);
    }
  });
});
