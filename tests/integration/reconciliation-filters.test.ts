import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { AMOUNTS, REASONS, type RowFilters, SORTS } from "@/lib/reconciliation/filters";
import { importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { type Lane, listRows, rowFacets } from "@/server/statements/review";
import { loadWorkspace } from "@/server/statements/ui-data";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { seedStaff } from "./reconciliation-helpers";
import { csv, nextReference, upiRow } from "./statements-helpers";

/**
 * RF: the Filters of the reconciliation workspace (D192) through the APP role, against SQL written in this test. The statement is the seeded demo sample (three rows of
 * ₹10,660, rows of every reason) plus generated rows that tie on amount and on date, a credit exactly at the threshold and one paisa under it. Every combination of sort,
 * amount and reason is paged with a page of 3 to the end and must return exactly the ids, in the order, of the independent query; the reason counts and the filtered total
 * are compared with plain counts; the facets take one query.
 */
let fx: PaymentsFixture;
let importId: string;
let thresholdPaise: bigint;

/** The codes of each reason group, written out again here (not read from the code under test): the design table of docs/manual-reconciliation-design.md. */
const CODES: Record<string, string[]> = {
  noflat: ["NO_NARRATION", "NO_MATCH"],
  several: ["CODE_AMBIGUOUS", "CODE_CONFLICT", "PAYER_SHARED", "MULTIPLE_FLATS_OWE"],
  differs: ["AMOUNT_PRINCIPAL_ONLY", "AMOUNT_LESS", "AMOUNT_MORE", "NO_OPEN_BILL", "HINT_CONFLICT"],
  low: ["NAME_INITIAL", "NAME_TRUNCATED", "LATER_PAYMENT", "NEEDS_SECOND_SIGNAL", "STATE_CHANGED"],
};

const rupees = (paise: bigint): string => `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;
const credit = (date: string, paise: bigint): string => `${date},UPI/${nextReference()}/PAYMENT FOR FLAT MAINTENANCE/maint,${rupees(paise)},`;

beforeAll(async () => {
  fx = await createPaymentsFixture();
  const priya = await seedStaff(fx, "5000000001");
  const sample = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "sample.csv", csvText: getSampleStatement(), now: DEMO_NOW });
  if (sample.status !== "IMPORTED") throw new Error(sample.status);
  importId = sample.importId;
  const setting = await fx.owner.societySetting.findUniqueOrThrow({ where: { key: "approval_threshold_paise" }, select: { value: true } });
  thresholdPaise = BigInt(setting.value as number);
  // The generated rows go into the SAME import's lanes through a second statement of their own; the sample's rows stay as they are. Rows tie on amount and on date.
  const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
  const lines = [
    ...Array.from({ length: 7 }, () => credit("2026-10-24", 500_000n)),
    ...Array.from({ length: 5 }, () => credit("2026-10-25", thresholdPaise)),
    ...Array.from({ length: 4 }, () => credit("2026-10-25", thresholdPaise - 1n)),
    ...Array.from({ length: 3 }, () => credit("2026-10-26", 123_400n)),
    upiRow(resident, 100_000n, "2026-10-26"),
    upiRow(resident, 4_000_000n, "2026-10-27"),
  ];
  const generated = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "ties.csv", csvText: csv(...lines), now: DEMO_NOW });
  if (generated.status !== "IMPORTED") throw new Error(generated.status);
  tiesImportId = generated.importId;
}, 240_000);
let tiesImportId: string;
afterAll(async () => {
  await fx?.close();
}, 60_000);

const STATES: Record<Lane, string> = { NEEDS_YOU: "('QUEUED')", AWAITING_APPROVAL: "('AWAITING_APPROVAL')", MATCHED: "('AUTO_MATCHED','MANUALLY_MATCHED')", NOT_MAINTENANCE: "('IGNORED')" };

/** The independent query: the ids of a lane's rows that match the filters, in the order asked for, read with plain SQL. */
async function expectedIds(forImport: string, lane: Lane, filters: RowFilters): Promise<string[]> {
  const where: string[] = [`import_id = '${forImport}'`, `state::text IN ${STATES[lane]}`];
  if (filters.amount === "high") where.push(`GREATEST(credit_paise, debit_paise) >= ${thresholdPaise}`);
  if (filters.amount === "low") where.push(`GREATEST(credit_paise, debit_paise) < ${thresholdPaise}`);
  if (filters.reason !== "any") where.push(`(${inGroup(filters.reason)})`);
  const order = filters.sort === "largest" ? "GREATEST(credit_paise, debit_paise) DESC, id ASC" : "txn_date ASC, id ASC";
  const rows = await fx.owner.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM bank_rows WHERE ${where.join(" AND ")} ORDER BY ${order}`);
  return rows.map((r) => r.id);
}

/** A row is in a group when its stored decision has one of the group's codes (asked with containment on the JSON), or, for "low", the matcher's LOW confidence. */
const inGroup = (group: string): string => {
  const byCode = CODES[group].map((code) => `parsed->'decision'->'reasons' @> '[{"code": "${code}"}]'::jsonb`).join(" OR ");
  return group === "low" ? `${byCode} OR parsed->'decision'->>'confidence' = 'LOW'` : byCode;
};

async function pagedIds(forImport: string, lane: Lane, filters: RowFilters, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const page = await listRows({ db: fx.app, importId: forImport, lane, cursor, limit, filters, thresholdPaise });
    if (page === null) throw new Error("no import");
    ids.push(...page.items.map((i) => i.id));
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("a cursor never ended");
}

const COMBINATIONS: RowFilters[] = SORTS.flatMap((sort) => AMOUNTS.flatMap((amount) => REASONS.map((reason) => ({ sort, amount, reason }))));

describe("RF1 the data has what the checks need", () => {
  it("the sample has the three ₹10,660 rows, and the generated rows tie and sit at the threshold", async () => {
    const tens = await fx.owner.bankRow.count({ where: { importId, creditPaise: 1_066_000n } });
    expect(tens).toBe(3);
    expect(await fx.owner.bankRow.count({ where: { importId: tiesImportId, creditPaise: thresholdPaise } })).toBe(5);
    expect(await fx.owner.bankRow.count({ where: { importId: tiesImportId, creditPaise: thresholdPaise - 1n } })).toBe(4);
  });
});

describe("RF2 every combination equals the independent query, page of 3, both sorts", () => {
  for (const [name, target] of [["the sample statement", () => importId], ["the generated rows with ties", () => tiesImportId]] as const) {
    it(`${name}: all ${COMBINATIONS.length} combinations in Needs you return the same ids in the same order, never repeating a row`, async () => {
      for (const filters of COMBINATIONS) {
        const expected = await expectedIds(target(), "NEEDS_YOU", filters);
        const got = await pagedIds(target(), "NEEDS_YOU", filters, 3);
        expect(new Set(got).size, `no repeat for ${JSON.stringify(filters)}`).toBe(got.length);
        expect(got, JSON.stringify(filters)).toEqual(expected);
      }
    }, 240_000);
  }

  it("the other lanes take sort and amount (the reason filter does not apply there) and still equal the independent query", async () => {
    for (const lane of ["MATCHED", "NOT_MAINTENANCE", "AWAITING_APPROVAL"] as const) {
      for (const sort of SORTS) {
        for (const amount of AMOUNTS) {
          const filters: RowFilters = { sort, amount, reason: "noflat" };
          expect(await pagedIds(importId, lane, filters, 3), `${lane} ${sort} ${amount}`).toEqual(await expectedIds(importId, lane, { ...filters, reason: "any" }));
        }
      }
    }
  }, 120_000);

  it("a credit exactly at the threshold is 'or more' and one paisa under is 'under'", async () => {
    const high = await pagedIds(tiesImportId, "NEEDS_YOU", { sort: "largest", amount: "high", reason: "any" }, 50);
    const low = await pagedIds(tiesImportId, "NEEDS_YOU", { sort: "largest", amount: "low", reason: "any" }, 50);
    const atThreshold = await fx.owner.bankRow.findMany({ where: { importId: tiesImportId, creditPaise: thresholdPaise }, select: { id: true } });
    const under = await fx.owner.bankRow.findMany({ where: { importId: tiesImportId, creditPaise: thresholdPaise - 1n }, select: { id: true } });
    for (const row of atThreshold) {
      expect(high).toContain(row.id);
      expect(low).not.toContain(row.id);
    }
    for (const row of under) {
      expect(low).toContain(row.id);
      expect(high).not.toContain(row.id);
    }
  });

  it("the three rows of ₹10,660 are all 'or more' with the demo threshold, and come back in a fixed order", async () => {
    const high = await pagedIds(importId, "NEEDS_YOU", { sort: "largest", amount: "high", reason: "any" }, 3);
    const tens = await fx.owner.bankRow.findMany({ where: { importId, creditPaise: 1_066_000n }, select: { id: true }, orderBy: { id: "asc" } });
    expect(thresholdPaise <= 1_066_000n).toBe(true);
    expect(high.filter((id) => tens.some((t) => t.id === id))).toEqual(tens.map((t) => t.id));
  });

  it("a filter that matches nothing gives an empty page and no cursor", async () => {
    const page = await listRows({ db: fx.app, importId: tiesImportId, lane: "MATCHED", filters: { sort: "oldest", amount: "high", reason: "any" }, thresholdPaise });
    expect(page?.items).toEqual([]);
    expect(page?.nextCursor).toBeNull();
  });

  it("a cursor of the other order starts again from the first page, and a hostile cursor too", async () => {
    const largest = await listRows({ db: fx.app, importId, lane: "NEEDS_YOU", limit: 3, filters: { sort: "largest", amount: "any", reason: "any" } });
    const oldest = await listRows({ db: fx.app, importId, lane: "NEEDS_YOU", limit: 3, filters: { sort: "oldest", amount: "any", reason: "any" } });
    const first = oldest?.items.map((i) => i.id);
    const crossed = await listRows({ db: fx.app, importId, lane: "NEEDS_YOU", limit: 3, filters: { sort: "oldest", amount: "any", reason: "any" }, cursor: largest?.nextCursor ?? undefined });
    expect(crossed?.items.map((i) => i.id)).toEqual(first);
    const hostile = await listRows({ db: fx.app, importId, lane: "NEEDS_YOU", limit: 3, filters: { sort: "oldest", amount: "any", reason: "any" }, cursor: "ZDIwMjYtMTAtMjQ6MQ" });
    expect(hostile?.items.map((i) => i.id)).toEqual(first);
  });
});

describe("RF3 the counts of the Filters sheet equal plain SQL, in one query", () => {
  it("for every combination in Needs you: the filtered total and the five reason counts", async () => {
    for (const filters of COMBINATIONS) {
      const facets = await rowFacets({ db: fx.app, importId: tiesImportId, lane: "NEEDS_YOU", filters, thresholdPaise });
      expect(facets.filteredTotal, JSON.stringify(filters)).toBe((await expectedIds(tiesImportId, "NEEDS_YOU", filters)).length);
      const lane = await expectedIds(tiesImportId, "NEEDS_YOU", { sort: "largest", amount: "any", reason: "any" });
      expect(facets.reasonCounts.any).toBe(lane.length);
      for (const group of Object.keys(CODES)) {
        expect(facets.reasonCounts[group as keyof typeof facets.reasonCounts], `${group} ${JSON.stringify(filters)}`).toBe((await expectedIds(tiesImportId, "NEEDS_YOU", { sort: "largest", amount: "any", reason: group as RowFilters["reason"] })).length);
      }
    }
  }, 120_000);

  it("the sample's counts too (a row can be in several groups, so the counts can add up to more than the lane)", async () => {
    const facets = await rowFacets({ db: fx.app, importId, lane: "NEEDS_YOU", thresholdPaise });
    const lane = (await expectedIds(importId, "NEEDS_YOU", { sort: "largest", amount: "any", reason: "any" })).length;
    expect(facets.reasonCounts.any).toBe(lane);
    expect(facets.reasonCounts).toEqual({ any: 43, noflat: 14, several: 8, differs: 19, low: 20 });
    expect(facets.reasonCounts.noflat + facets.reasonCounts.several + facets.reasonCounts.differs + facets.reasonCounts.low).toBeGreaterThan(facets.reasonCounts.any);
    for (const group of Object.keys(CODES)) expect(facets.reasonCounts[group as keyof typeof facets.reasonCounts]).toBe((await expectedIds(importId, "NEEDS_YOU", { sort: "largest", amount: "any", reason: group as RowFilters["reason"] })).length);
  });

  it("takes exactly one database operation", async () => {
    let operations = 0;
    const counted = fx.app.$extends({
      query: {
        $allOperations({ args, query }) {
          operations += 1;
          return query(args);
        },
      },
    }) as unknown as typeof fx.app;
    await rowFacets({ db: counted, importId, lane: "NEEDS_YOU", filters: { sort: "oldest", amount: "high", reason: "several" }, thresholdPaise });
    expect(operations).toBe(1);
  });
});

describe("RF4 the workspace loader carries the filters, the threshold and the facets", () => {
  it("returns the effective filters, the filtered total and the setting's threshold; a reason on a lane without reasons is dropped", async () => {
    const priya = await seedStaff(fx, "5000000001");
    const needs = await loadWorkspace({ db: fx.app, user: priya, importId, lane: "NEEDS_YOU", now: DEMO_NOW, filters: { sort: "oldest", amount: "high", reason: "noflat" } });
    expect(needs?.thresholdPaise).toBe(thresholdPaise.toString());
    expect(needs?.filters).toEqual({ sort: "oldest", amount: "high", reason: "noflat" });
    expect(needs?.facets.filteredTotal).toBe((await expectedIds(importId, "NEEDS_YOU", { sort: "oldest", amount: "high", reason: "noflat" })).length);
    const posted = await loadWorkspace({ db: fx.app, user: priya, importId, lane: "MATCHED", now: DEMO_NOW, filters: { sort: "oldest", amount: "high", reason: "noflat" } });
    expect(posted?.filters.reason).toBe("any");
    expect(posted?.laneCounts).toEqual(needs?.laneCounts);
  });
});
