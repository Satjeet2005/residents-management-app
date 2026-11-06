import { describe, expect, it } from "vitest";
import { flatContextsFromDataset } from "@/domain/matching/benchmark/population";
import { defaultMatchSettings } from "@/domain/matching/context";
import { parseStatementCsv } from "@/domain/matching/csv";
import { processStatement } from "@/domain/matching/processor";
import { buildSampleStatement } from "@/domain/matching/sample-statement";
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

  it("has about 120 rows, all valid, dated 20 to 27 October 2026, with a header the reader knows", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(100);
    expect(parsed.rows.length).toBeLessThanOrEqual(130);
    const dates = parsed.rows.map((r) => r.txnDate).sort();
    expect(dates[0] >= "2026-10-20" && dates.at(-1)! <= "2026-10-27").toBe(true);
  });

  it("holds every case the demo needs, and decided on the demo flats each becomes what the design says", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: defaultMatchSettings, alreadyImportedKeys: new Set() });
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

  it("the processor accounts for every row of it", () => {
    const parsed = parseStatementCsv(getSampleStatement());
    const processed = processStatement({ rows: parsed.rows, csvErrors: [], flats: flatContextsFromDataset(dataset), settings: defaultMatchSettings, alreadyImportedKeys: new Set() });
    expect(processed.accounted).toBe(true);
    expect(processed.summary.autoMatched + processed.summary.queued + processed.summary.ignored).toBe(parsed.rows.length);
  });
});
