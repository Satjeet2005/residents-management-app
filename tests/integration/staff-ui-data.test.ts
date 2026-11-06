import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import type { RowCard } from "@/lib/reconciliation/types";
import { approvalView } from "@/lib/reconciliation/permission-view";
import { approveRequest, ignoreRow, rejectRequest } from "@/server/statements/approval";
import { postManualMatch } from "@/server/statements/manual";
import { decideAccess } from "@/server/auth/access";
import { resolveSession } from "@/server/auth/session-service";
import { importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { PAGE_SIZE, StaffAccessError, loadImportList, loadReview, loadRowCards, loadWorkspace, readThreshold } from "@/server/statements/ui-data";
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
    const data = await loadWorkspace({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU", now: DEMO_NOW });
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
    expect(await loadWorkspace({ db: fx.app, user: priya, importId: crypto.randomUUID(), lane: "NEEDS_YOU", now: DEMO_NOW })).toBeNull();
    expect(await loadWorkspace({ db: fx.app, user: priya, importId: "not-an-id", lane: "NEEDS_YOU", now: DEMO_NOW })).toBeNull();
    expect(await loadRowCards({ db: fx.app, user: priya, importId: crypto.randomUUID(), lane: "NEEDS_YOU" })).toBeNull();
  });

  it("a resident, and staff without payments:match, cannot load the workspace or a page of rows", async () => {
    const resident = await fx.makeResident();
    const reports = await newStaff(fx, ["reports:view"]);
    const asResident = { id: resident.user.id, role: "RESIDENT" as const, active: true, permissions: ["payments:match"] };
    for (const user of [asResident, reports]) {
      await expect(loadWorkspace({ db: fx.app, user, importId: sampleImportId, lane: "NEEDS_YOU", now: DEMO_NOW })).rejects.toBeInstanceOf(StaffAccessError);
      await expect(loadRowCards({ db: fx.app, user, importId: sampleImportId, lane: "MATCHED" })).rejects.toBeInstanceOf(StaffAccessError);
    }
  });
});

describe("UD5 the review of a row", () => {
  const principalRow = async () => fx.owner.bankRow.findFirstOrThrow({ where: { importId: sampleImportId, narrationRaw: { contains: "710000000003" } } });

  it("holds the bank facts, the stored reasons, the candidates with their open positions and the threshold from the society setting", async () => {
    const row = await principalRow();
    const review = await loadReview({ db: fx.app, user: priya, importId: sampleImportId, rowId: row.id, now: DEMO_NOW });
    expect(review).toMatchObject({ id: row.id, importId: sampleImportId, version: 1, state: "QUEUED", txnDate: "2026-10-27", creditPaise: "566000", rail: "UPI", reference: "710000000003", thresholdPaise: "1000000" });
    expect(review?.narration).toBe(row.narrationRaw);
    expect(review?.reasons.map((r) => r.code)).toContain("AMOUNT_PRINCIPAL_ONLY");
    const t21 = review?.candidates.find((c) => c.flatCode === "T21-1601");
    expect(t21).toMatchObject({ amountRelation: "EQUALS_PRINCIPAL", residents: ["Aamir Shaikh"] });
    expect(t21?.openPositions[0]).toMatchObject({ kind: "PRINCIPAL_OPEN", principalOutstandingPaise: "566000", feePaise: "3800", amountDuePaise: "569800" });
    expect(review?.payerName).not.toBeUndefined();
  });

  it("D116 the threshold is read from the setting, so changing the setting changes what the panel says", async () => {
    expect(await readThreshold(fx.app)).toBe(1_000_000n);
    await fx.owner.$executeRaw`UPDATE society_settings SET value = '2500000'::jsonb WHERE key = 'approval_threshold_paise'`;
    try {
      const row = await principalRow();
      expect((await loadReview({ db: fx.app, user: priya, importId: sampleImportId, rowId: row.id, now: DEMO_NOW }))?.thresholdPaise).toBe("2500000");
    } finally {
      await fx.owner.$executeRaw`UPDATE society_settings SET value = '1000000'::jsonb WHERE key = 'approval_threshold_paise'`;
    }
  });

  it("a row of another import, a row that does not exist and an id that is not an id are null", async () => {
    const row = await principalRow();
    const other = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "third.csv", csvText: csv("2026-10-25,CASH DEPOSIT,12.00,"), now: DEMO_NOW });
    if (other.status !== "IMPORTED") throw new Error(other.status);
    expect(await loadReview({ db: fx.app, user: priya, importId: other.importId, rowId: row.id, now: DEMO_NOW })).toBeNull();
    expect(await loadReview({ db: fx.app, user: priya, importId: sampleImportId, rowId: crypto.randomUUID(), now: DEMO_NOW })).toBeNull();
    expect(await loadReview({ db: fx.app, user: priya, importId: sampleImportId, rowId: "nope", now: DEMO_NOW })).toBeNull();
  });

  it("the workspace carries the review of ?row= and none without it", async () => {
    const row = await principalRow();
    const withRow = await loadWorkspace({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU", rowId: row.id, now: DEMO_NOW });
    expect(withRow?.review?.id).toBe(row.id);
    const without = await loadWorkspace({ db: fx.app, user: priya, importId: sampleImportId, lane: "NEEDS_YOU", now: DEMO_NOW });
    expect(without?.review).toBeNull();
  });

  it("a resident and staff without payments:match cannot load a review", async () => {
    const row = await principalRow();
    const resident = await fx.makeResident();
    const reports = await newStaff(fx, ["reports:view"]);
    for (const user of [{ id: resident.user.id, role: "RESIDENT" as const, active: true, permissions: ["payments:match"] }, reports]) {
      await expect(loadReview({ db: fx.app, user, importId: sampleImportId, rowId: row.id, now: DEMO_NOW })).rejects.toBeInstanceOf(StaffAccessError);
    }
  });
});

describe("UD6 the lanes after people have acted (the requester and the approver, as the app role)", () => {
  const rowWith = async (text: string) => fx.owner.bankRow.findFirstOrThrow({ where: { importId: sampleImportId, narrationRaw: { contains: text } } });
  const lane = async (name: "AWAITING_APPROVAL" | "MATCHED" | "NOT_MAINTENANCE" | "NEEDS_YOU") => {
    const out: RowCard[] = [];
    let cursor: string | undefined;
    do {
      const page = await loadRowCards({ db: fx.app, user: rahul, importId: sampleImportId, lane: name, cursor });
      out.push(...(page?.rows ?? []));
      cursor = page?.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return out;
  };

  it("an automatic posting is 'Automatic' with its late fee and payment, found through the hashed keys", async () => {
    const posted = await lane("MATCHED");
    const swati = posted.find((r) => r.narration.includes("710000000001"));
    expect(swati?.posted).toMatchObject({ flatCode: "T12-0408", by: { kind: "AUTO" } });
    expect(swati?.posted?.entries).toEqual([
      { entryType: "LATE_FEE", amountPaise: "9800" },
      { entryType: "PAYMENT", amountPaise: "646800" },
    ]);
    expect(posted.filter((r) => r.posted?.by.kind === "AUTO")).toHaveLength(25);
  });

  it("a manual match shows 'Manual by <name>' with the entries it posted, in Posted", async () => {
    const row = await rowWith("710000000003");
    const done = await postManualMatch({ db: fx.app, user: priya, rowId: row.id, flatCode: "T21-1601", reason: "Owner paid at the branch", rememberPayer: false, expectedVersion: 1, now: DEMO_NOW });
    expect(done.status).toBe("POSTED");
    const card = (await lane("MATCHED")).find((r) => r.id === row.id);
    expect(card?.posted).toEqual({ flatCode: "T21-1601", by: { kind: "MANUAL", name: "Priya Nair", approvedBy: null }, entries: [{ entryType: "LATE_FEE", amountPaise: "3800" }, { entryType: "PAYMENT", amountPaise: "566000" }] });
    expect((await lane("NEEDS_YOU")).some((r) => r.id === row.id)).toBe(false);
  });

  it("a request shows who asked, what, why and when; the requester waits, a different approver acts; then it is posted with the approver named", async () => {
    const row = await rowWith("730000000001");
    const review = await loadReview({ db: fx.app, user: priya, importId: sampleImportId, rowId: row.id, now: DEMO_NOW });
    const flat = review?.candidates[0];
    expect(BigInt(review?.creditPaise ?? "0") >= 1_000_000n).toBe(true);
    const asked = await postManualMatch({ db: fx.app, user: priya, rowId: row.id, flatCode: flat?.flatCode ?? "", reason: "The code and the name agree", rememberPayer: false, expectedVersion: 1, expectedAmountDuePaise: BigInt(flat?.openPositions[0].amountDuePaise ?? "0"), now: DEMO_NOW });
    expect(asked).toEqual({ status: "AWAITING_APPROVAL", thresholdPaise: "1000000" });

    const waiting = (await lane("AWAITING_APPROVAL")).find((r) => r.id === row.id);
    expect(waiting?.request).toEqual({ requestedById: priya.id, requestedBy: "Priya Nair", action: "MATCH", flatCode: flat?.flatCode, reason: "The code and the name agree", requestedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(approvalView(priya, waiting?.request?.requestedById ?? "")).toBe("WAITING");
    expect(approvalView(rahul, waiting?.request?.requestedById ?? "")).toBe("ACTIONS");
    expect(await approveRequest({ db: fx.app, user: priya, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });

    const approved = await approveRequest({ db: fx.app, user: rahul, rowId: row.id, note: "Checked the statement", now: DEMO_NOW });
    expect(approved).toMatchObject({ status: "APPROVED", action: "MATCH", flatCode: flat?.flatCode });
    const posted = (await lane("MATCHED")).find((r) => r.id === row.id);
    expect(posted?.posted?.by).toEqual({ kind: "MANUAL", name: "Priya Nair", approvedBy: "Rahul Menon" });
    expect(posted?.posted?.entries.map((e) => e.entryType)).toEqual(["LATE_FEE", "PAYMENT"]);
  });

  it("the requester who also holds payments:approve still waits, and cannot approve (SELF_APPROVAL)", async () => {
    const row = await rowWith("N710000000007");
    expect(await ignoreRow({ db: fx.app, user: rahul, rowId: row.id, reason: "Looks like a vendor refund", expectedVersion: 1, now: DEMO_NOW })).toEqual({ status: "AWAITING_APPROVAL", thresholdPaise: "1000000" });
    const card = (await lane("AWAITING_APPROVAL")).find((r) => r.id === row.id);
    expect(card?.request).toMatchObject({ requestedBy: "Rahul Menon", action: "IGNORE", flatCode: null, reason: "Looks like a vendor refund" });
    expect(approvalView(rahul, card?.request?.requestedById ?? "")).toBe("WAITING");
    expect(await approveRequest({ db: fx.app, user: rahul, rowId: row.id, now: DEMO_NOW })).toEqual({ status: "ERROR", error: "SELF_APPROVAL" });
    expect(await rejectRequest({ db: fx.app, user: priya, rowId: row.id, reason: "Not mine to approve", now: DEMO_NOW })).toEqual({ status: "ERROR", error: "FORBIDDEN" });
  });

  it("an approved ignore is in Not maintenance with the reason; an automatic ignore shows its kind", async () => {
    const row = await rowWith("N710000000007");
    const second = await newStaff(fx, ["payments:match", "payments:approve"]);
    expect(await approveRequest({ db: fx.app, user: second, rowId: row.id, note: "Agreed, a vendor refund", now: DEMO_NOW })).toMatchObject({ status: "APPROVED", action: "IGNORE" });
    const ignored = await lane("NOT_MAINTENANCE");
    expect(ignored.find((r) => r.id === row.id)?.ignored).toEqual({ ignoreKind: null, reason: "Agreed, a vendor refund" });
    const charge = ignored.find((r) => r.narration.includes("SMS CHARGES Q2"));
    expect(charge?.ignored).toEqual({ ignoreKind: "DEBIT", reason: null });
    expect(ignored.find((r) => r.narration.includes("INT PD 01-07-2026"))?.ignored).toEqual({ ignoreKind: "INTEREST", reason: null });
    expect(ignored.find((r) => r.narration.includes("ACME HOUSEKEEPING"))?.ignored?.ignoreKind).toBe("DEBIT");
  });

  it("a rejection sends the row back to Needs you, out of Awaiting approval", async () => {
    const row = await rowWith("730000000002");
    const review = await loadReview({ db: fx.app, user: priya, importId: sampleImportId, rowId: row.id, now: DEMO_NOW });
    const flat = review?.candidates[0];
    expect(await postManualMatch({ db: fx.app, user: priya, rowId: row.id, flatCode: flat?.flatCode ?? "", reason: "The loose code and the name agree", rememberPayer: false, expectedVersion: 1, now: DEMO_NOW })).toMatchObject({ status: "AWAITING_APPROVAL" });
    expect((await lane("AWAITING_APPROVAL")).some((r) => r.id === row.id)).toBe(true);
    expect(await rejectRequest({ db: fx.app, user: rahul, rowId: row.id, reason: "The name belongs to another flat", now: DEMO_NOW })).toEqual({ status: "REJECTED" });
    expect((await lane("AWAITING_APPROVAL")).some((r) => r.id === row.id)).toBe(false);
    expect((await lane("NEEDS_YOU")).some((r) => r.id === row.id)).toBe(true);
  });

  it("the lane counts and the summary still add up after all of that, and the books are accounted for", async () => {
    const data = await loadWorkspace({ db: fx.app, user: rahul, importId: sampleImportId, lane: "NEEDS_YOU", now: DEMO_NOW });
    const c = data?.counts;
    expect(c?.accounted).toBe(true);
    expect((c?.autoMatched ?? 0) + (c?.manuallyMatched ?? 0) + (c?.needsYou ?? 0) + (c?.awaitingApproval ?? 0) + (c?.notMaintenance ?? 0)).toBe(106);
    expect(c?.manuallyMatched).toBe(2);
  });
});

describe("UD7 who the pages let in (the decision requireUser makes, with real sessions)", () => {
  const sessionUser = async (userId: string, role: "STAFF" | "RESIDENT") => {
    const cookie = await fx.signIn(userId, role, DEMO_NOW);
    const found = await resolveSession(fx.app, cookie.split(";")[0].split("=").slice(1).join("="), DEMO_NOW);
    if (found === null) throw new Error("no session");
    return found.user;
  };

  it("for payments:match: Priya and Rahul are in; a resident, reports-only staff and approve-only staff are sent to /forbidden; nobody signed in goes to login", async () => {
    const resident = await fx.makeResident();
    const reports = await newStaff(fx, ["reports:view"]);
    const approveOnly = await newStaff(fx, ["payments:approve"]);
    expect(decideAccess(await sessionUser(priya.id, "STAFF"), "payments:match").kind).toBe("ok");
    expect(decideAccess(await sessionUser(rahul.id, "STAFF"), "payments:match").kind).toBe("ok");
    expect(decideAccess(await sessionUser(resident.user.id, "RESIDENT"), "payments:match").kind).toBe("forbidden");
    expect(decideAccess(await sessionUser(reports.id, "STAFF"), "payments:match").kind).toBe("forbidden");
    expect(decideAccess(await sessionUser(approveOnly.id, "STAFF"), "payments:match").kind).toBe("forbidden");
    expect(decideAccess(null, "payments:match").kind).toBe("login");
  });

  it("for /staff (any active staff): reports-only staff are in, a resident is not", async () => {
    const resident = await fx.makeResident();
    const reports = await newStaff(fx, ["reports:view"]);
    expect(decideAccess(await sessionUser(reports.id, "STAFF"), "STAFF").kind).toBe("ok");
    expect(decideAccess(await sessionUser(resident.user.id, "RESIDENT"), "STAFF").kind).toBe("forbidden");
  });
});
