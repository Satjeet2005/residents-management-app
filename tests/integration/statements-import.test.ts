import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeLateFee, defaultLateFeePolicy } from "@/domain/billing/late-fee";
import { DEMO_NOW } from "@/domain/seed/types";
import { initiatePayment } from "@/server/payments/initiate";
import { applyGatewayEvent } from "@/server/payments/webhook";
import { IMPORT_LIMITS, StatementLimitError, getStatementSummary, importStatement, isAccounted, type ImportHooks, type ImportResult } from "@/server/statements/import";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { DUE_ON_27_OCT, HEADER, balanceOf, counts, csv, nextReference, upiRow } from "./statements-helpers";

/**
 * SI1 to SI7 (small statements): the import runs as the APP role against the seeded database, in one transaction.
 * A flat the test needs to itself is made with makeResident (the ledger is append-only, so a test cannot clean up).
 */
let fx: PaymentsFixture;
let staffId: string;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  staffId = (await fx.userByPhone("5000000001")).id;
}, 120_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const run = (csvText: string, hooks?: ImportHooks, filename = "statement.csv"): Promise<ImportResult> => importStatement({ db: fx.app, user: { id: staffId }, filename, csvText, now: DEMO_NOW, hooks });
const imported = async (csvText: string, hooks?: ImportHooks) => {
  const result = await run(csvText, hooks);
  if (result.status !== "IMPORTED") throw new Error(`expected IMPORTED, got ${result.status}`);
  return result;
};
const rowsOf = (importId: string) => fx.owner.bankRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" } });

describe("SI1 an exact payment is posted automatically", () => {
  it("posts a LATE_FEE of ₹98 and one PAYMENT of ₹6,468 dated the row's date, with the bill and the bank row, and zeroes the bill", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)));
    expect(result.summary).toMatchObject({ rowsRead: 1, validRows: 1, invalidRows: 0, autoMatched: 1, queued: 0, ignored: 0, alreadyImported: 0, downgraded: 0, creditTotalPaise: "646800", autoMatchedTotalPaise: "646800" });
    expect(result.accounted).toBe(true);

    const [row] = await rowsOf(result.importId);
    expect(row).toMatchObject({ state: "AUTO_MATCHED", flatId: resident.flatId, version: 2, creditPaise: 646_800n, debitPaise: 0n });
    const entries = await fx.owner.ledgerEntry.findMany({ where: { flatId: resident.flatId, entryType: { in: ["LATE_FEE", "PAYMENT"] } }, orderBy: { entryType: "asc" } });
    expect(entries.map((e) => [e.entryType, e.direction, e.amountPaise, e.effectiveDate.toISOString().slice(0, 10), e.billId, e.bankRowId])).toEqual([
      ["LATE_FEE", "CHARGE", 9_800n, "2026-10-27", resident.billId, null],
      ["PAYMENT", "PAYMENT", 646_800n, "2026-10-27", resident.billId, row.id],
    ]);
    const payment = entries[1];
    expect(row.ledgerEntryId).toBe(payment.id);
    expect(payment.reference).toMatch(/^bank:upi:[0-9]{12}$/);
    expect(payment.reference).not.toContain(resident.name);
    expect(entries.map((e) => e.idempotencyKey)).toEqual([`bank:${row.dedupeKey}:LATE_FEE`, `bank:${row.dedupeKey}:PAYMENT`]);
    expect(await balanceOf(fx, resident.flatId)).toBe(0n);
  });

  it("writes one payment_matches row with the score and the reasons, and no human actor", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)));
    const [row] = await rowsOf(result.importId);
    const matches = await fx.owner.paymentMatch.findMany({ where: { bankRowId: row.id } });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ decision: "AUTO", flatId: resident.flatId, decidedById: null, approverId: null });
    expect(matches[0].score).toBeGreaterThan(0);
    expect((matches[0].reasons as { code: string }[]).map((r) => r.code)).toEqual(expect.arrayContaining(["CODE_FOUND", "AMOUNT_EQUALS_DUE"]));
  });

  it("keeps the decision in the row's parsed JSON (kind, confidence, reasons, at most 5 candidates) and no plan", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)));
    const [row] = await rowsOf(result.importId);
    const parsed = row.parsed as { rail: string; decision: { kind: string; confidence: string; reasons: unknown[]; candidates: unknown[]; totalCandidates: number; ignoreKind: string | null; plan?: unknown } };
    expect(parsed.rail).toBe("UPI");
    expect(parsed.decision).toMatchObject({ kind: "AUTO_MATCH", confidence: "HIGH", ignoreKind: null });
    expect(parsed.decision.candidates.length).toBeLessThanOrEqual(5);
    expect(parsed.decision.totalCandidates).toBeGreaterThanOrEqual(1);
    expect(parsed.decision.plan).toBeUndefined();
  });

  it("audits the import with counts only, and the automatic posting with ids; no narration text is in either", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)));
    const audit = await fx.owner.auditLog.findMany({ where: { entityType: "statement_import", entityId: result.importId }, orderBy: { action: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["BANK_ROW_AUTO_POSTED", "STATEMENT_IMPORTED"]);
    expect(audit.every((a) => a.actorId === staffId)).toBe(true);
    const text = JSON.stringify(audit.map((a) => a.detail));
    expect(text).not.toContain(resident.name);
    expect(text).not.toContain(resident.flatCode);
    expect(text).not.toContain("UPI/");
    expect(audit[1].detail).toMatchObject({ autoMatched: 1, queued: 0, rowsRead: 1 });
    const [row] = await rowsOf(result.importId);
    expect(audit[0].detail).toMatchObject({ bankRowIds: [row.id], ledgerEntryIds: [row.ledgerEntryId] });
  });

  it("stores the import with the file's SHA-256, the row count and the uploader", async () => {
    const resident = await fx.makeResident();
    const text = csv(upiRow(resident, DUE_ON_27_OCT));
    const result = await imported(text);
    const record = await fx.owner.statementImport.findUniqueOrThrow({ where: { id: result.importId } });
    const { createHash } = await import("node:crypto");
    expect(record).toMatchObject({ uploadedById: staffId, filename: "statement.csv", rowsRead: 1 });
    expect(record.fileSha256).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
});

describe("SI1 unclear and non-maintenance rows", () => {
  it("a payment of the principal only is QUEUED with one OPEN BANK_ROW queue item, and posts nothing", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, 637_000n)));
    expect(result.summary).toMatchObject({ autoMatched: 0, queued: 1 });
    const [row] = await rowsOf(result.importId);
    expect(row).toMatchObject({ state: "QUEUED", flatId: null, ledgerEntryId: null, version: 1 });
    const items = await fx.owner.accountsQueueItem.findMany({ where: { bankRowId: row.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemType: "BANK_ROW", status: "OPEN", paymentAttemptId: null });
    expect(await balanceOf(fx, resident.flatId)).toBe(637_000n);
    expect((row.parsed as { decision: { reasons: { code: string }[] } }).decision.reasons.map((r) => r.code)).toContain("AMOUNT_PRINCIPAL_ONLY");
  });

  it("a vendor debit and a bank interest credit are IGNORED: stored with their state, no queue item, no ledger entry", async () => {
    const before = await counts(fx);
    const result = await imported(csv("2026-10-26,NEFT/ACME HOUSEKEEPING/INV 33,,12000.00", "2026-10-26,INT PD 01-07-2026 TO 30-09-2026,418.00,"));
    expect(result.summary).toMatchObject({ validRows: 2, ignored: 2, autoMatched: 0, queued: 0 });
    const rows = await rowsOf(result.importId);
    expect(rows.map((r) => r.state)).toEqual(["IGNORED", "IGNORED"]);
    const after = await counts(fx);
    expect(after.queue).toBe(before.queue);
    expect(after.ledger).toBe(before.ledger);
  });
});

describe("SI3 idempotence and overlap", () => {
  it("importing the same file again gives all ALREADY_IMPORTED and changes no row, entry, match or queue item", async () => {
    const resident = await fx.makeResident();
    const text = csv(upiRow(resident, DUE_ON_27_OCT), "2026-10-26,NEFT/ACME HOUSEKEEPING/INV 34,,500.00");
    const first = await imported(text);
    const before = await counts(fx);
    const again = await imported(text);
    expect(again.summary).toMatchObject({ validRows: 2, alreadyImported: 2, autoMatched: 0, queued: 0, ignored: 0 });
    expect(again.importId).not.toBe(first.importId);
    const after = await counts(fx);
    expect({ rows: after.rows, ledger: after.ledger, matches: after.matches, queue: after.queue }).toEqual({ rows: before.rows, ledger: before.ledger, matches: before.matches, queue: before.queue });
    expect(await rowsOf(again.importId)).toEqual([]);
  });

  it("overlapping files skip the overlap and take only the new rows", async () => {
    const a = await fx.makeResident();
    const b = await fx.makeResident();
    const rowA = upiRow(a, DUE_ON_27_OCT);
    const first = await imported(csv(rowA));
    const second = await imported(csv(rowA, upiRow(b, DUE_ON_27_OCT)));
    expect(first.summary.autoMatched).toBe(1);
    expect(second.summary).toMatchObject({ validRows: 2, alreadyImported: 1, autoMatched: 1 });
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: a.flatId, entryType: "PAYMENT" } })).toBe(1);
  });

  it("two identical cash rows are both stored, and importing the file again skips both", async () => {
    const cash = "2026-10-25,BY CASH DEPOSIT CDM 4455,1500.00,";
    const text = csv(cash, cash);
    const first = await imported(text);
    expect(first.summary).toMatchObject({ validRows: 2, queued: 2, alreadyImported: 0 });
    expect((await rowsOf(first.importId)).map((r) => r.dedupeKey).filter((k, i, all) => all.indexOf(k) === i)).toHaveLength(2);
    const again = await imported(text);
    expect(again.summary).toMatchObject({ validRows: 2, alreadyImported: 2, queued: 0 });
  });

  it("a payment reference seen twice in one file is one payment", async () => {
    const resident = await fx.makeResident();
    const ref = nextReference();
    const row = upiRow(resident, DUE_ON_27_OCT, "2026-10-27", ref);
    const result = await imported(csv(row, row));
    expect(result.summary).toMatchObject({ validRows: 2, autoMatched: 1, alreadyImported: 1 });
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId, entryType: "PAYMENT" } })).toBe(1);
  });
});

describe("SI4 invalid input", () => {
  it.each([
    ["a header with no narration column", "Txn Date,Credit,Debit\n2026-10-27,10.00,\n"],
    ["no header at all", ""],
    ["a header with no amount column", "Txn Date,Narration\n2026-10-27,x\n"],
  ])("%s is INVALID_CSV and stores nothing", async (_label, text) => {
    const before = await counts(fx);
    const result = await run(text);
    expect(result.status).toBe("INVALID_CSV");
    expect(result.status === "INVALID_CSV" && result.errors[0].rowNumber).toBe(0);
    expect(await counts(fx)).toEqual(before);
  });

  it("bad rows are counted apart from valid ones, reported, and never dropped; the good rows are still processed", async () => {
    const result = await imported(csv("not-a-date,UPI/1/x,10.00,", "2026-10-26,NEFT/ACME HOUSEKEEPING/INV 35,,25.00", "2026-10-26,BAD AMOUNT,abc,"));
    expect(result.summary).toMatchObject({ rowsRead: 3, validRows: 1, invalidRows: 2, ignored: 1 });
    expect(result.csvErrors.map((e) => e.rowNumber)).toEqual([1, 3]);
    expect(result.accounted).toBe(true);
    const summary = await getStatementSummary(fx.app, result.importId);
    expect(summary?.summary).toMatchObject({ rowsRead: 3, validRows: 1, invalidRows: 2, ignored: 1 });
    expect(summary?.accounted).toBe(true);
  });

  it("reports at most 50 row errors", async () => {
    const result = await imported(csv(...Array.from({ length: 80 }, () => "bad-date,x,10.00,")));
    expect(result.summary.invalidRows).toBe(80);
    expect(result.csvErrors).toHaveLength(50);
  });

  describe("a file that is too big is refused before any database work", () => {
    const untouchable = new Proxy({}, { get: () => { throw new Error("the database was touched"); } }) as never;
    const refuse = (csvText: string) => importStatement({ db: untouchable, user: { id: "x" }, filename: "s.csv", csvText, now: DEMO_NOW });
    it("over 2,000,000 characters is TOO_LARGE", async () => {
      const error = await refuse("x".repeat(IMPORT_LIMITS.maxChars + 1)).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(RangeError);
      expect(error).toBeInstanceOf(StatementLimitError);
      expect((error as StatementLimitError).code).toBe("TOO_LARGE");
    });
    it("more than 20,000 rows is TOO_MANY_ROWS", async () => {
      const text = csv(...Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_x, i) => `2026-10-26,CASH ${i},1.00,`));
      expect(text.length).toBeLessThan(IMPORT_LIMITS.maxChars);
      expect(((await refuse(text).then(() => null, (e: unknown) => e)) as StatementLimitError).code).toBe("TOO_MANY_ROWS");
    });
    it("a NUL byte is NUL_BYTES", async () => {
      expect(((await refuse(`${HEADER}\n2026-10-26,CASH\0,1.00,\n`).then(() => null, (e: unknown) => e)) as StatementLimitError).code).toBe("NUL_BYTES");
    });
  });
});

describe("SI2 accounted", () => {
  it("the summary equals what is read back from the database, and a corrupted copy makes isAccounted false", async () => {
    const resident = await fx.makeResident();
    const other = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT), upiRow(other, 637_000n), "2026-10-26,NEFT/ACME HOUSEKEEPING/INV 36,,25.00"));
    expect(result.summary).toMatchObject({ autoMatched: 1, queued: 1, ignored: 1 });
    const stored = await getStatementSummary(fx.app, result.importId);
    expect(stored?.summary).toMatchObject({ autoMatched: 1, queued: 1, ignored: 1, validRows: 3, alreadyImported: 0 });
    expect(stored?.accounted).toBe(true);
    expect(await getStatementSummary(fx.app, crypto.randomUUID())).toBeNull();
  });

  it("isAccounted is false when the stored counts, the queue items or the payments differ from the processor's books", async () => {
    const { processStatement } = await import("@/domain/matching/processor");
    const { defaultMatchSettings } = await import("@/domain/matching/context");
    const { flat, bill } = await import("../domain/matching/builders");
    const { readCsv } = await import("../domain/matching/processor-helpers");
    const { rows } = readCsv(["2026-10-27,UPI/301234567890/T12-0408 Swati Joshi/maintenance,6468.00,", "2026-10-26,INT PD 12.00,12.00,"]);
    const processed = processStatement({ rows, csvErrors: [], flats: [flat("T12-0408", { residents: ["Swati Joshi"], bills: [bill("b", 637_000n, "2026-09-10")] })], settings: defaultMatchSettings, alreadyImportedKeys: new Set() });
    const good = { stored: { AUTO_MATCHED: 1, QUEUED: 0, IGNORED: 1 }, queueItems: 0, payments: 1, paymentTotalPaise: 646_800n };
    expect(isAccounted(processed, good)).toBe(true);
    expect(isAccounted(processed, { ...good, stored: { ...good.stored, QUEUED: 1 } })).toBe(false);
    expect(isAccounted(processed, { ...good, stored: { ...good.stored, AUTO_MATCHED: 0 } })).toBe(false);
    expect(isAccounted(processed, { ...good, queueItems: 1 })).toBe(false);
    expect(isAccounted(processed, { ...good, payments: 2 })).toBe(false);
    expect(isAccounted(processed, { ...good, paymentTotalPaise: 646_799n })).toBe(false);
    expect(isAccounted({ ...processed, accounted: false }, good)).toBe(false);
    expect(isAccounted({ ...processed, summary: { ...processed.summary, validRows: 3 } }, good)).toBe(false);
  });
});

describe("SI7 atomicity: all or nothing", () => {
  it("a failure before the commit leaves no import, bank row, ledger entry, match, queue item or audit row", async () => {
    const auto = await fx.makeResident();
    const queued = await fx.makeResident();
    const before = await counts(fx);
    const failing = run(csv(upiRow(auto, DUE_ON_27_OCT), upiRow(queued, 637_000n), "2026-10-26,NEFT/ACME HOUSEKEEPING/INV 37,,25.00"), {
      beforeCommit: async () => {
        // At this point everything has been written inside the transaction.
        throw new Error("boom before commit");
      },
    });
    await expect(failing).rejects.toThrow("boom before commit");
    expect(await counts(fx)).toEqual(before);
    expect(await balanceOf(fx, auto.flatId)).toBe(637_000n);
  });

  it("the same file imports normally afterwards (no key was left behind)", async () => {
    const auto = await fx.makeResident();
    const text = csv(upiRow(auto, DUE_ON_27_OCT));
    await expect(run(text, { beforeCommit: async () => { throw new Error("boom"); } })).rejects.toThrow("boom");
    expect((await imported(text)).summary.autoMatched).toBe(1);
  });
});

describe("SI6 the bill changed between the snapshot and the posting", () => {
  it("a gateway payment committed after the snapshot downgrades the row to QUEUED with STATE_CHANGED, and posts nothing from the bank", async () => {
    const resident = await fx.makeResident();
    const started = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: DUE_ON_27_OCT, now: DEMO_NOW });
    if (started.status !== "CREATED") throw new Error(started.status);
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)), {
      afterSnapshot: async () => {
        const gateway = await applyGatewayEvent(fx.app, { eventId: "evt-si6", type: "payment.succeeded", reference: `MOCK-${started.attemptId}`, amountPaise: DUE_ON_27_OCT }, DEMO_NOW);
        expect(gateway).toEqual({ outcome: "POSTED" });
      },
    });
    expect(result.summary).toMatchObject({ autoMatched: 0, queued: 1, downgraded: 1, autoMatchedTotalPaise: "0" });
    expect(result.accounted).toBe(true);
    const [row] = await rowsOf(result.importId);
    expect(row).toMatchObject({ state: "QUEUED", ledgerEntryId: null, flatId: null });
    expect((row.parsed as { decision: { kind: string; reasons: { code: string }[] } }).decision).toMatchObject({ kind: "QUEUE" });
    expect((row.parsed as { decision: { reasons: { code: string }[] } }).decision.reasons.map((r) => r.code)).toContain("STATE_CHANGED");
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId, entryType: "PAYMENT" } })).toBe(1);
    expect(await fx.owner.ledgerEntry.count({ where: { bankRow: { importId: result.importId } } })).toBe(0);
    expect(await fx.owner.accountsQueueItem.count({ where: { bankRowId: row.id, status: "OPEN" } })).toBe(1);
    expect(await balanceOf(fx, resident.flatId)).toBe(0n);
  });

  it("a part payment committed after the snapshot downgrades the row too", async () => {
    const resident = await fx.makeResident();
    const result = await imported(csv(upiRow(resident, DUE_ON_27_OCT)), {
      afterSnapshot: async () => {
        await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 100_000n, effectiveDate: new Date("2026-10-20T00:00:00Z"), idempotencyKey: `si6-part:${resident.billId}` } });
      },
    });
    expect(result.summary).toMatchObject({ autoMatched: 0, downgraded: 1, queued: 1 });
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId, entryType: "PAYMENT" } })).toBe(1);
  });

  it("a payment dated after the row, committed after the snapshot, downgrades the row", async () => {
    const resident = await fx.makeResident();
    const fee = computeLateFee({ billAmountPaise: 637_000n, dueOn: "2026-09-10", asOf: "2026-10-26", payments: [], holds: [], policy: defaultLateFeePolicy }).feePaise;
    const result = await imported(csv(upiRow(resident, 637_000n + fee, "2026-10-26")), {
      afterSnapshot: async () => {
        await fx.owner.ledgerEntry.create({ data: { flatId: resident.flatId, billId: resident.billId, entryType: "PAYMENT", direction: "PAYMENT", amountPaise: 1_000n, effectiveDate: new Date("2026-10-27T00:00:00Z"), idempotencyKey: `si6-later:${resident.billId}` } });
      },
    });
    expect(result.summary).toMatchObject({ autoMatched: 0, downgraded: 1 });
  });
});

describe("SI5 concurrency: imports and the gateway take turns", () => {
  it("two imports of the same file at once both finish or one is IMPORT_IN_PROGRESS, and the bill is paid once", async () => {
    const resident = await fx.makeResident();
    const text = csv(upiRow(resident, DUE_ON_27_OCT));
    const results = await Promise.all([run(text), run(text)]);
    const done = results.filter((r): r is Extract<ImportResult, { status: "IMPORTED" }> => r.status === "IMPORTED");
    expect(done.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === "IMPORTED" || r.status === "IMPORT_IN_PROGRESS")).toBe(true);
    expect(done.reduce((sum, r) => sum + r.summary.autoMatched, 0)).toBe(1);
    expect(await fx.owner.ledgerEntry.count({ where: { flatId: resident.flatId, entryType: "PAYMENT" } })).toBe(1);
    expect(await balanceOf(fx, resident.flatId)).toBe(0n);
  });

  it("a gateway success and a bank auto-post racing for one bill give exactly ONE payment, and the loser is an exception or a downgrade", async () => {
    for (let round = 0; round < 3; round++) {
      const resident = await fx.makeResident();
      const started = await initiatePayment({ db: fx.app, user: resident.user, expectedAmountPaise: DUE_ON_27_OCT, now: DEMO_NOW });
      if (started.status !== "CREATED") throw new Error(started.status);
      const [gateway, bank] = await Promise.all([
        applyGatewayEvent(fx.app, { eventId: `evt-race-${round}-${resident.billId}`, type: "payment.succeeded", reference: `MOCK-${started.attemptId}`, amountPaise: DUE_ON_27_OCT }, DEMO_NOW),
        run(csv(upiRow(resident, DUE_ON_27_OCT))),
      ]);
      expect(await fx.owner.ledgerEntry.count({ where: { billId: resident.billId, entryType: "PAYMENT" } }), `round ${round}`).toBe(1);
      expect(await balanceOf(fx, resident.flatId), `round ${round}`).toBe(0n);
      if (bank.status !== "IMPORTED") throw new Error(`the import did not finish: ${bank.status}`);
      const gatewayWon = gateway.outcome === "POSTED";
      if (gatewayWon) expect(bank.summary.autoMatched === 0 && (bank.summary.queued === 1)).toBe(true);
      else expect(gateway.outcome).toBe("EXCEPTION");
    }
  });
});
