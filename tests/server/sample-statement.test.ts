import { describe, expect, it } from "vitest";
import { flatContextsFromDataset } from "@/domain/matching/benchmark/population";
import { parseStatementCsv } from "@/domain/matching/csv";
import { processStatement } from "@/domain/matching/processor";
import { DEMO_MATCH_SETTINGS, buildSampleStatement } from "@/domain/matching/sample-statement";
import { generateDemoDataset } from "@/domain/seed/generate";
import { getSampleStatement } from "@/server/statements/sample-statement";

/** D105: the sample statement is generated, and the committed copy must be what the generator makes. */
const dataset = generateDemoDataset();
const regenerated = buildSampleStatement(dataset);

describe("D105 the sample statement", () => {
  it("drift: the committed copy equals what the generator makes now (run `npm run sample:statement` if this fails)", () => {
    expect(getSampleStatement()).toBe(regenerated);
  });

  it("is deterministic: building it twice gives the same bytes", () => {
    expect(buildSampleStatement(dataset)).toBe(regenerated);
  });

  it("has at most 120 rows, all valid, dated 20 to 27 October 2026, with a header the reader knows", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(100);
    expect(parsed.rows.length).toBeLessThanOrEqual(120);
    const dates = parsed.rows.map((r) => r.txnDate).sort();
    expect(dates[0] >= "2026-10-20" && dates.at(-1)! <= "2026-10-27").toBe(true);
  });

  it("holds every case the demo needs, and decided on the demo flats each becomes what the design says", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: DEMO_MATCH_SETTINGS, alreadyImportedKeys: new Set() });
    const of = (text: string) => {
      const row = parsed.rows.find((r) => r.narrationRaw.includes(text));
      if (row === undefined) throw new Error(`no row with ${text}`);
      return processed.rows.find((r) => r.rowNumber === row.rowNumber)!;
    };
    const codes = (text: string) => of(text).decision?.reasons.map((r) => r.code);
    expect(of("710000000001")).toMatchObject({ state: "AUTO_MATCHED" });
    expect(of("710000000002")).toMatchObject({ state: "AUTO_MATCHED" });
    expect(of("710000000003")).toMatchObject({ state: "QUEUED" });
    expect(of("710000000003").decision?.confidence).toBe("MEDIUM");
    expect(codes("710000000003")).toContain("AMOUNT_PRINCIPAL_ONLY");
    expect(of("710000000004")).toMatchObject({ state: "QUEUED" });
    expect(of("710000000004").decision?.confidence).toBe("LOW");
    expect(codes("710000000004")).toContain("MULTIPLE_FLATS_OWE");
    expect(of("710000000005")).toMatchObject({ state: "QUEUED" });
    expect(of("CHQ DEP 482913")).toMatchObject({ state: "QUEUED" });
    expect(codes("710000000006")).toContain("NO_OPEN_BILL");
    expect(of("N710000000007")).toMatchObject({ state: "QUEUED" });
    expect(codes("N710000000007")).toContain("ABOVE_THRESHOLD");
    expect(of("ACME HOUSEKEEPING")).toMatchObject({ state: "IGNORED" });
    expect(of("POWER BOARD")).toMatchObject({ state: "IGNORED" });
    expect(of("INT PD 01-07-2026")).toMatchObject({ state: "IGNORED" });
    expect(of("SMS CHARGES Q2")).toMatchObject({ state: "IGNORED" });
    const cash = parsed.rows.filter((r) => r.narrationRaw.includes("CDM 220117"));
    expect(cash).toHaveLength(2);
    expect(new Set(processed.rows.filter((r) => cash.some((c) => c.rowNumber === r.rowNumber)).map((r) => r.dedupeKey)).size).toBe(2);
  });

  it("MP8 the mix: 106 rows, 25 posted automatically, 43 queued, 38 ignored, accounted, in well under a second (an illustration, not the benchmark)", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const started = performance.now();
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: DEMO_MATCH_SETTINGS, alreadyImportedKeys: new Set() });
    const elapsed = performance.now() - started;
    expect(parsed.rows).toHaveLength(106);
    expect(processed.summary).toMatchObject({ rowsRead: 106, validRows: 106, invalidRows: 0, autoMatched: 25, queued: 43, ignored: 38, alreadyImported: 0 });
    expect(processed.summary.creditTotalPaise).toBe(90_932_600n);
    expect(processed.summary.autoMatchedTotalPaise).toBe(15_036_700n);
    expect(processed.accounted).toBe(true);
    expect(elapsed, `${Math.round(elapsed)} ms`).toBeLessThan(2000);
  });

  it("the 18 well-formed payments name a registered UPI id, the flat code and a clean name, pay exactly the amount due, and are all posted", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: DEMO_MATCH_SETTINGS, alreadyImportedKeys: new Set() });
    const formed = parsed.rows.filter((r) => /^UPI\/72000000\d{4}\//.test(r.narrationRaw));
    expect(formed).toHaveLength(18);
    for (const row of formed) {
      const decided = processed.rows.find((r) => r.rowNumber === row.rowNumber);
      expect(decided?.state, row.narrationRaw).toBe("AUTO_MATCHED");
      expect(decided?.decision?.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["CODE_FOUND", "PAYER_KNOWN", "AMOUNT_EQUALS_DUE"]));
    }
    expect(new Set(formed.map((r) => r.narrationRaw.split("/")[4])).size).toBe(18);
  });

  it("D116 holds at least three queued credits of the demo threshold or more, each with exactly one candidate flat, so a manual match can be approved", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: DEMO_MATCH_SETTINGS, alreadyImportedKeys: new Set() });
    const high = parsed.rows.filter((r) => /UPI[/|]73000000\d{4}[/|]/.test(r.narrationRaw));
    expect(high.length).toBeGreaterThanOrEqual(3);
    for (const row of high) {
      const decided = processed.rows.find((r) => r.rowNumber === row.rowNumber);
      expect(row.creditPaise >= 1_000_000n, row.narrationRaw).toBe(true);
      expect(decided?.state, row.narrationRaw).toBe("QUEUED");
      expect(decided?.decision?.totalCandidates, row.narrationRaw).toBe(1);
      expect(decided?.decision?.reasons.map((r) => r.code)).toContain("ABOVE_THRESHOLD");
    }
  });

  it("D116 no automatically posted row is at or above the demo threshold", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: DEMO_MATCH_SETTINGS, alreadyImportedKeys: new Set() });
    for (const row of processed.rows.filter((r) => r.state === "AUTO_MATCHED")) expect(row.creditPaise < 1_000_000n).toBe(true);
  });

  it("the processor accounts for every row of it", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: DEMO_MATCH_SETTINGS, alreadyImportedKeys: new Set() });
    expect(processed.accounted).toBe(true);
    expect(processed.summary.autoMatched + processed.summary.queued + processed.summary.ignored).toBe(parsed.rows.length);
  });
});
