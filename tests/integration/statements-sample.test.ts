import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { parseStatementCsv } from "@/domain/matching/csv";
import { getHomeData } from "@/server/home/home-data";
import { type ImportResult, getStatementSummary, importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";

/** SI1, SI2, SI3 and SI9 on the 106-row sample statement, imported into the seeded 2,400-flat database as the app role. */
let fx: PaymentsFixture;
let staffId: string;
let first: Extract<ImportResult, { status: "IMPORTED" }>;
let importMs = 0;
let ledgerBefore: { payments: bigint; charges: bigint };
let ledgerAfter: { payments: bigint; charges: bigint };

const ledgerTotals = async (): Promise<{ payments: bigint; charges: bigint }> => {
  const sums = await fx.owner.ledgerEntry.groupBy({ by: ["direction"], _sum: { amountPaise: true } });
  const sum = (direction: string): bigint => sums.find((s) => s.direction === direction)?._sum.amountPaise ?? 0n;
  return { payments: sum("PAYMENT"), charges: sum("CHARGE") };
};

beforeAll(async () => {
  fx = await createPaymentsFixture();
  staffId = (await fx.userByPhone("5000000001")).id;
  ledgerBefore = await ledgerTotals();
  const started = performance.now();
  const result = await importStatement({ db: fx.app, user: { id: staffId }, filename: "sample.csv", csvText: getSampleStatement(), now: DEMO_NOW });
  importMs = performance.now() - started;
  if (result.status !== "IMPORTED") throw new Error(`the sample did not import: ${result.status}`);
  first = result;
  ledgerAfter = await ledgerTotals();
}, 180_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const rowByText = async (text: string) => fx.owner.bankRow.findFirstOrThrow({ where: { importId: first.importId, narrationRaw: { contains: text } } });

describe("SI1 the sample statement: exact counts per state", () => {
  it("106 rows: 25 posted automatically, 43 queued for a person, 38 ignored, none repeated, none refused", () => {
    expect(first.summary).toEqual({
      rowsRead: 106,
      validRows: 106,
      invalidRows: 0,
      autoMatched: 25,
      queued: 43,
      ignored: 38,
      alreadyImported: 0,
      downgraded: 0,
      creditTotalPaise: "90932600",
      autoMatchedTotalPaise: "15036700",
    });
    expect(first.accounted).toBe(true);
    expect(first.csvErrors).toEqual([]);
  });

  it("the database holds the same counts: rows per state, one OPEN queue item per queued row, nothing else queued", async () => {
    const states = await fx.owner.bankRow.groupBy({ by: ["state"], where: { importId: first.importId }, _count: { _all: true } });
    expect(Object.fromEntries(states.map((s) => [s.state, s._count._all]))).toEqual({ AUTO_MATCHED: 25, QUEUED: 43, IGNORED: 38 });
    expect(await fx.owner.accountsQueueItem.count({ where: { itemType: "BANK_ROW", status: "OPEN", bankRow: { importId: first.importId } } })).toBe(43);
    expect(await fx.owner.accountsQueueItem.count({ where: { bankRow: { importId: first.importId, state: { not: "QUEUED" } } } })).toBe(0);
  });

  it("T12-0408 is posted with a LATE_FEE of ₹98 and a PAYMENT of ₹6,468, both dated 2026-10-27, and its bill owes nothing", async () => {
    const row = await rowByText("710000000001");
    expect(row).toMatchObject({ state: "AUTO_MATCHED", creditPaise: 646_800n });
    const flat = await fx.owner.flat.findUniqueOrThrow({ where: { code: "T12-0408" } });
    expect(row.flatId).toBe(flat.id);
    const entries = await fx.owner.ledgerEntry.findMany({ where: { flatId: flat.id, entryType: { in: ["LATE_FEE", "PAYMENT"] }, effectiveDate: new Date("2026-10-27T00:00:00Z") }, orderBy: { entryType: "asc" } });
    expect(entries.map((e) => [e.entryType, e.amountPaise, e.effectiveDate.toISOString().slice(0, 10)])).toEqual([
      ["LATE_FEE", 9_800n, "2026-10-27"],
      ["PAYMENT", 646_800n, "2026-10-27"],
    ]);
    expect(entries[1].bankRowId).toBe(row.id);
    expect(row.ledgerEntryId).toBe(entries[1].id);
    const user = await fx.userByPhone("5000000007");
    const home = await getHomeData({ db: fx.app, user, now: DEMO_NOW });
    expect(home.kind === "OK" && home.dues.status).toBe("ALL_PAID");
    expect(home.kind === "OK" && home.dues.amountDuePaise).toBe(0n);
  });

  it("T15-0902: the oldest bill is paid and the second stays open", async () => {
    const row = await rowByText("710000000002");
    expect(row.state).toBe("AUTO_MATCHED");
    const user = await fx.userByPhone("5000000010");
    const home = await getHomeData({ db: fx.app, user, now: DEMO_NOW });
    expect(home.kind === "OK" && home.dues.openBills).toHaveLength(1);
  });

  it("the unclear rows are queued for a person with the reasons: principal only, look-alike flats, typo code, cheque, advance, above the threshold, cash", async () => {
    const reasons = async (text: string) => ((await rowByText(text)).parsed as { decision: { kind: string; confidence: string; reasons: { code: string }[] } }).decision;
    const principal = await reasons("710000000003");
    expect(principal).toMatchObject({ kind: "QUEUE", confidence: "MEDIUM" });
    expect(principal.reasons.map((r) => r.code)).toContain("AMOUNT_PRINCIPAL_ONLY");
    const lookAlike = await reasons("710000000004");
    expect(lookAlike).toMatchObject({ kind: "QUEUE", confidence: "LOW" });
    expect(lookAlike.reasons.map((r) => r.code)).toContain("MULTIPLE_FLATS_OWE");
    expect((await reasons("710000000005")).kind).toBe("QUEUE");
    expect((await reasons("CHQ DEP 482913")).kind).toBe("QUEUE");
    expect((await reasons("710000000006")).reasons.map((r) => r.code)).toContain("NO_OPEN_BILL");
    expect((await reasons("N710000000007")).reasons.map((r) => r.code)).toContain("ABOVE_THRESHOLD");
    expect(await fx.owner.bankRow.count({ where: { importId: first.importId, narrationRaw: { contains: "CDM 220117" }, state: "QUEUED" } })).toBe(2);
  });

  it("the debits, the interest and the bank charge are IGNORED with no ledger entry and no queue item", async () => {
    for (const text of ["ACME HOUSEKEEPING", "POWER BOARD", "INT PD 01-07-2026", "SMS CHARGES Q2"]) {
      const row = await rowByText(text);
      expect(row.state, text).toBe("IGNORED");
      expect(await fx.owner.accountsQueueItem.count({ where: { bankRowId: row.id } })).toBe(0);
    }
  });

  it("the payments side of the ledger moves by exactly the automatic total, and the charges side by exactly the late fees", async () => {
    expect(ledgerAfter.payments - ledgerBefore.payments).toBe(15_036_700n);
    const autoRows = await fx.owner.bankRow.findMany({ where: { importId: first.importId, state: "AUTO_MATCHED" }, select: { id: true } });
    const fees = await fx.owner.ledgerEntry.aggregate({ where: { entryType: "LATE_FEE", effectiveDate: { gte: new Date("2026-10-20T00:00:00Z") }, bill: { ledgerEntries: { some: { bankRowId: { in: autoRows.map((r) => r.id) } } } } }, _sum: { amountPaise: true } });
    expect(ledgerAfter.charges - ledgerBefore.charges).toBe(fees._sum.amountPaise);
  });

  it("every AUTO row has exactly one payment_matches row with the reasons, and one PAYMENT; nothing else has a match", async () => {
    const autoRows = await fx.owner.bankRow.findMany({ where: { importId: first.importId, state: "AUTO_MATCHED" }, include: { matches: true, fundedEntries: true } });
    expect(autoRows).toHaveLength(25);
    for (const row of autoRows) {
      expect(row.matches, row.narrationRaw).toHaveLength(1);
      expect(row.matches[0]).toMatchObject({ decision: "AUTO", decidedById: null, flatId: row.flatId });
      expect((row.matches[0].reasons as unknown[]).length).toBeGreaterThan(0);
      expect(row.fundedEntries.filter((e) => e.entryType === "PAYMENT")).toHaveLength(1);
      expect(row.fundedEntries.find((e) => e.entryType === "PAYMENT")?.amountPaise).toBe(row.creditPaise);
    }
    expect(await fx.owner.paymentMatch.count({ where: { bankRow: { importId: first.importId } } })).toBe(25);
  });
});

describe("MP7 D106 ledger references of the sample's postings", () => {
  it("every bank reference is bank:<rail>:<reference> in clear or bank:h: and 32 hex, and none contains narration text", async () => {
    const entries = await fx.owner.ledgerEntry.findMany({ where: { reference: { startsWith: "bank:" } }, select: { reference: true, bankRow: { select: { narrationRaw: true, parsed: true } } } });
    expect(entries).toHaveLength(25);
    for (const e of entries) {
      const reference = e.reference as string;
      expect(reference, reference).toMatch(/^bank:(?:[a-z]+:[A-Za-z0-9]{4,40}|h:[0-9a-f]{32})$/);
      const parsed = e.bankRow?.parsed as { reference: string | null; rail: string };
      if (parsed.reference !== null) expect(reference).toBe(`bank:${parsed.rail.toLowerCase()}:${parsed.reference}`);
      for (const word of (e.bankRow?.narrationRaw ?? "").split(/[^A-Za-z]+/).filter((w) => w.length >= 4)) expect(reference.split(":").slice(2).join(":").toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  it("the 18 well-formed payments are posted automatically with their bank reference in clear", async () => {
    const rows = await fx.owner.bankRow.findMany({ where: { importId: first.importId, narrationRaw: { contains: "/maintenance" }, state: "AUTO_MATCHED", ledgerEntry: { reference: { startsWith: "bank:upi:72000000" } } } });
    expect(rows).toHaveLength(18);
  });
});

describe("SI2 accounted for the sample", () => {
  it("the stored summary read back from the database equals the one returned, and every row is accounted for", async () => {
    const stored = await getStatementSummary(fx.app, first.importId);
    expect(stored?.accounted).toBe(true);
    expect(stored?.summary).toMatchObject({ rowsRead: 106, validRows: 106, autoMatched: 25, queued: 43, ignored: 38, alreadyImported: 0, invalidRows: 0 });
    const rows = parseStatementCsv(getSampleStatement()).rows.length;
    const { autoMatched, queued, ignored } = first.summary;
    expect(autoMatched + queued + ignored).toBe(rows);
  });
});

describe("SI3 importing the sample again", () => {
  it("gives 106 ALREADY_IMPORTED and changes no bank row, ledger entry, match or queue item", async () => {
    const before = await Promise.all([fx.owner.bankRow.count(), fx.owner.ledgerEntry.count(), fx.owner.paymentMatch.count(), fx.owner.accountsQueueItem.count()]);
    const again = await importStatement({ db: fx.app, user: { id: staffId }, filename: "sample-again.csv", csvText: getSampleStatement(), now: DEMO_NOW });
    expect(again.status === "IMPORTED" && again.summary).toMatchObject({ validRows: 106, alreadyImported: 106, autoMatched: 0, queued: 0, ignored: 0 });
    const after = await Promise.all([fx.owner.bankRow.count(), fx.owner.ledgerEntry.count(), fx.owner.paymentMatch.count(), fx.owner.accountsQueueItem.count()]);
    expect(after).toEqual(before);
  });
});

describe("SI9 speed", () => {
  it("importing the 106-row sample took under 10 s", () => {
    expect(importMs, `${Math.round(importMs)} ms`).toBeLessThan(10_000);
  });
});
