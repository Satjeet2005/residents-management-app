import { describe, expect, it } from "vitest";
import { MAX_FILE_CHARS, checkFileText, failureText, formatFileSize, importedText, interpretImportResponse, invalidCsvLines } from "@/lib/reconciliation/import";
import { staffToolsFor } from "@/lib/staff-tools";

describe("RU1 the file is checked before it is sent", () => {
  it("an empty file and one over 2,000,000 characters are refused with a sentence; the limit itself is allowed", () => {
    expect(MAX_FILE_CHARS).toBe(2_000_000);
    expect(checkFileText("")).toEqual({ ok: false, message: "The file is empty, so nothing was sent." });
    expect(checkFileText("  \n ")).toMatchObject({ ok: false });
    expect(checkFileText("x".repeat(2_000_001))).toEqual({ ok: false, message: expect.stringContaining("over 2,000,000 characters") });
    expect(checkFileText("x".repeat(2_000_000))).toEqual({ ok: true });
    expect(checkFileText("Txn Date,Narration,Credit,Debit\n")).toEqual({ ok: true });
  });

  it("sizes read as bytes, KB or MB", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(1)).toBe("1 byte");
    expect(formatFileSize(812)).toBe("812 bytes");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1_258_291)).toBe("1.2 MB");
    expect(() => formatFileSize(-1)).toThrow(RangeError);
  });
});

describe("RU2 answers of POST /api/statements", () => {
  const imported = { importId: "i-1", accounted: true, summary: { rowsRead: 105, autoMatched: 25, queued: 43, ignored: 38, alreadyImported: 0, invalidRows: 0 }, csvErrors: [] };

  it("200 is IMPORTED with the counts, and the line says them", () => {
    const outcome = interpretImportResponse(200, imported);
    expect(outcome).toEqual({ kind: "IMPORTED", importId: "i-1", summary: { rowsRead: 105, autoMatched: 25, queued: 43, ignored: 38, alreadyImported: 0, invalidRows: 0 } });
    expect(importedText("october.csv", (outcome as { summary: Parameters<typeof importedText>[1] }).summary)).toBe("Imported october.csv: 105 rows read. 25 posted automatically, 43 need you, 38 not maintenance, 0 already imported.");
  });

  it("a 200 that is not accounted, or has no counts, is not a success", () => {
    expect(interpretImportResponse(200, { ...imported, accounted: false })).toEqual({ kind: "FAILED" });
    expect(interpretImportResponse(200, { importId: "i", accounted: true, summary: {} })).toEqual({ kind: "FAILED" });
    expect(interpretImportResponse(200, null)).toEqual({ kind: "FAILED" });
  });

  it("422 INVALID_CSV keeps the errors; the lines show the first 5 and the count", () => {
    const errors = Array.from({ length: 8 }, (_x, i) => ({ rowNumber: i === 0 ? 0 : i + 1, column: "narration", message: `bad thing ${i}` }));
    const outcome = interpretImportResponse(422, { error: "INVALID_CSV", errors });
    expect(outcome.kind).toBe("INVALID_CSV");
    const lines = invalidCsvLines((outcome as { errors: { rowNumber: number; message: string }[] }).errors);
    expect(lines).toEqual(["bad thing 0", "Row 2: bad thing 1", "Row 3: bad thing 2", "Row 4: bad thing 3", "Row 5: bad thing 4", "8 problems in all, the first 5 are shown."]);
    expect(invalidCsvLines([{ rowNumber: 0, message: "The header has no narration column" }])).toEqual(["The header has no narration column", "1 problem in all."]);
  });

  it("413, 409 IMPORT_IN_PROGRESS, 403 and anything else each have their own outcome and sentence", () => {
    expect(interpretImportResponse(413, { error: "TOO_LARGE" })).toEqual({ kind: "TOO_LARGE" });
    expect(interpretImportResponse(409, { error: "IMPORT_IN_PROGRESS" })).toEqual({ kind: "IN_PROGRESS" });
    expect(interpretImportResponse(403, { error: "FORBIDDEN" })).toEqual({ kind: "FORBIDDEN" });
    expect(interpretImportResponse(500, {})).toEqual({ kind: "FAILED" });
    expect(interpretImportResponse(409, { error: "OTHER" })).toEqual({ kind: "FAILED" });
    const texts = (["TOO_LARGE", "IN_PROGRESS", "FORBIDDEN", "FAILED", "NETWORK"] as const).map((kind) => failureText({ kind }));
    expect(new Set(texts).size).toBe(5);
    expect(failureText({ kind: "IN_PROGRESS" })).toMatch(/Another import is running/);
    expect(failureText({ kind: "NETWORK" })).toMatch(/could not reach the server/);
  });
});

describe("RU3 the staff tools", () => {
  const staff = (permissions: string[]) => ({ role: "STAFF" as const, active: true, permissions });

  it("Bank reconciliation is a tool for payments:match only", () => {
    expect(staffToolsFor(staff(["payments:match"])).map((t) => t.href)).toEqual(["/staff/reconciliation"]);
    expect(staffToolsFor(staff(["payments:approve"]))).toEqual([]);
    expect(staffToolsFor(staff(["reports:view"]))).toEqual([]);
    expect(staffToolsFor({ ...staff(["payments:match"]), active: false })).toEqual([]);
    expect(staffToolsFor({ role: "RESIDENT", active: true, permissions: ["payments:match"] })).toEqual([]);
  });
});
