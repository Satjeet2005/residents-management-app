import { describe, expect, it } from "vitest";
import { parseStatementCsv, parseStatementDate } from "@/domain/matching/csv";

const HEADER = "txn_date,value_date,narration,credit,debit,balance,reference";

describe("P1 statement CSV: reading", () => {
  it("reads a canonical file", () => {
    const result = parseStatementCsv(`${HEADER}\n2026-10-05,2026-10-05,UPI/402200118877/x@ybl/maint,6370,,100000.50,REF1\n`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { rowNumber: 1, txnDate: "2026-10-05", valueDate: "2026-10-05", narrationRaw: "UPI/402200118877/x@ybl/maint", creditPaise: 637000n, debitPaise: 0n, balancePaise: 10000050n, reference: "REF1" },
    ]);
  });

  it.each([
    ["a UTF-8 BOM", `﻿${HEADER}\n2026-10-05,,A,100,,,\n`],
    ["CRLF line ends", `${HEADER}\r\n2026-10-05,,A,100,,,\r\n`],
    ["a lone CR line end", `${HEADER}\r2026-10-05,,A,100,,,\r`],
    ["no final newline", `${HEADER}\n2026-10-05,,A,100,,,`],
    ["blank lines", `\n${HEADER}\n\n2026-10-05,,A,100,,,\n\n\n`],
    ["rows of only commas", `${HEADER}\n,,,,,,\n2026-10-05,,A,100,,,\n`],
    ["trailing commas", `${HEADER},\n2026-10-05,,A,100,,,,\n`],
  ])("accepts %s", (_label, text) => {
    const result = parseStatementCsv(text);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rowNumber).toBe(1);
    expect(result.rows[0].creditPaise).toBe(10000n);
  });

  it("keeps commas, doubled quotes and line breaks inside a quoted narration, exactly", () => {
    const narration = ' NEFT-N1-"GUPTA, R"\nT12 408 ';
    const quoted = `"${narration.replaceAll('"', '""')}"`;
    const result = parseStatementCsv(`${HEADER}\n2026-10-05,,${quoted},100,,,\n`);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].narrationRaw).toBe(narration);
  });

  it("does not trim an unquoted narration", () => {
    const result = parseStatementCsv(`${HEADER}\n2026-10-05,,  spaced  ,100,,,\n`);
    expect(result.rows[0].narrationRaw).toBe("  spaced  ");
  });

  it("accepts an empty narration, which then waits for a person", () => {
    const result = parseStatementCsv(`${HEADER}\n2026-10-05,,,100,,,\n`);
    expect(result.rows[0].narrationRaw).toBe("");
  });

  it("numbers the data rows from 1, skipping blank lines", () => {
    const result = parseStatementCsv(`${HEADER}\n2026-10-01,,A,1,,,\n\n2026-10-02,,B,2,,,\n2026-10-03,,C,3,,,\n`);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2, 3]);
  });
});

describe("P1 statement CSV: header aliases and extra columns", () => {
  it.each([
    ["Date,Particulars,Deposit,Withdrawal,Closing Balance,Chq No", { Date: "txn_date", Particulars: "narration", Deposit: "credit", Withdrawal: "debit", "Closing Balance": "balance", "Chq No": "reference" }],
    [" TRANSACTION DATE , Value Dt , Remarks , CR , DR , Balance , Ref No ", { "TRANSACTION DATE": "txn_date", "Value Dt": "value_date", Remarks: "narration", CR: "credit", DR: "debit", Balance: "balance", "Ref No": "reference" }],
    ["Txn Date,Description,Credit Amount,Debit Amount,Ref,Value Date", { "Txn Date": "txn_date", Description: "narration", "Credit Amount": "credit", "Debit Amount": "debit", Ref: "reference", "Value Date": "value_date" }],
    ["txn date,narration,deposits,withdrawals,cheque number", { "txn date": "txn_date", narration: "narration", deposits: "credit", withdrawals: "debit", "cheque number": "reference" }],
  ])("maps the headers of %s", (header, expected) => {
    const result = parseStatementCsv(`${header}\n`);
    expect(result.errors).toEqual([]);
    expect(result.headerMap).toEqual(expected);
  });

  it("reads a file that uses aliases", () => {
    const result = parseStatementCsv("Date,Particulars,Deposit,Withdrawal\n05/10/2026,SMS CHARGES,,29.50\n");
    expect(result.rows[0]).toMatchObject({ txnDate: "2026-10-05", narrationRaw: "SMS CHARGES", creditPaise: 0n, debitPaise: 2950n });
  });

  it("accepts a file with only a credit column", () => {
    const result = parseStatementCsv("date,narration,credit\n2026-10-05,A,100\n");
    expect(result.errors).toEqual([]);
    expect(result.rows[0].debitPaise).toBe(0n);
  });

  it("ignores unknown columns and reports them, also repeated ones", () => {
    const result = parseStatementCsv("date,narration,credit,Branch Code,credit amount,\n2026-10-05,A,100,042,999,\n");
    expect(result.errors).toEqual([]);
    expect(result.ignoredColumns).toEqual(["Branch Code", "credit amount"]);
    expect(result.rows[0].creditPaise).toBe(10000n);
  });

  it("a header that is a built-in object key is just an unknown column", () => {
    const result = parseStatementCsv("constructor,date,narration,credit\nx,2026-10-05,A,1\n");
    expect(result.errors).toEqual([]);
    expect(result.ignoredColumns).toEqual(["constructor"]);
  });
});

describe("P1 statement CSV: fatal header problems", () => {
  it.each([
    ["no txn_date", "narration,credit\nA,1\n", "txn_date"],
    ["no narration", "date,credit\n2026-10-05,1\n", "narration"],
    ["neither credit nor debit", "date,narration,balance\n2026-10-05,A,1\n", "credit"],
  ])("reports %s before reading any row", (_label, text, column) => {
    const result = parseStatementCsv(text);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ rowNumber: 0, column })]);
    expect(result.errors[0].message).toMatch(/^header: /);
  });

  it("reports every missing column at once", () => {
    expect(parseStatementCsv("balance\n1\n").errors.map((e) => e.column)).toEqual(["txn_date", "narration", "credit"]);
  });

  it.each(["", "\n\n", "﻿", ",,\n"])("reports a file with no header row: %j", (text) => {
    expect(parseStatementCsv(text).errors).toEqual([{ rowNumber: 0, column: "header", message: "header: the file has no header row" }]);
  });
});

describe("P1 statement CSV: dates", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["05/10/2026", "2026-10-05"],
    ["5/10/2026", "2026-10-05"],
    ["05-10-2026", "2026-10-05"],
    ["05-Oct-2026", "2026-10-05"],
    ["5-oct-2026", "2026-10-05"],
    ["05-OCT-2026", "2026-10-05"],
    ["29-Feb-2028", "2028-02-29"],
    ["  05/10/2026  ", "2026-10-05"],
  ])("reads %s", (text, expected) => {
    expect(parseStatementDate(text)).toBe(expected);
  });

  it.each(["05/10/26", "05-10-26", "05-Oct-26", "2026/10/05", "10/05/2026x", "31-04-2026", "29-02-2027", "00-10-2026", "05-Foo-2026", "05 Oct 2026", "", "tomorrow", "2026-13-01"])("rejects %j", (text) => {
    expect(parseStatementDate(text)).toBeNull();
  });
});

describe("P1 statement CSV: amounts and row errors", () => {
  const one = (credit: string, debit: string, extra = "") => parseStatementCsv(`date,narration,credit,debit,balance\n2026-10-05,A,"${credit}","${debit}",${extra}\n`);

  it.each([
    ["6370", 637000n],
    ["1,06,468", 10646800n],
    ["1,234.5", 123450n],
    ["₹98.43", 9843n],
    ["0.05", 5n],
    ["  50  ", 5000n],
  ])("reads the credit %s", (text, expected) => {
    const result = one(text, "");
    expect(result.errors).toEqual([]);
    expect(result.rows[0].creditPaise).toBe(expected);
  });

  it.each([
    ["a negative", "-50", "", "credit must not be negative"],
    ["a plus sign", "+50", "", "credit must not be negative or carry a sign"],
    ["letters", "5O0", "", "credit is not a number"],
    ["three decimals", "1.234", "", "credit has more than 2 decimal places"],
    ["a bad comma", "1,,000", "", "credit is not a number"],
    ["a negative debit", "", "-5", "debit must not be negative"],
    ["both sides positive", "5", "5", "credit and debit are both positive"],
    ["neither side", "", "", "credit and debit are both empty"],
    ["zero on both sides", "0", "0.00", "credit and debit are both empty"],
  ])("reports %s", (_label, credit, debit, message) => {
    const result = one(credit, debit);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ rowNumber: 1 });
    expect(result.errors[0].message).toContain(`row 1: ${message}`);
  });

  it("reports a bad balance and a bad date, naming each column", () => {
    const result = parseStatementCsv("date,value date,narration,credit,balance\n05-13-2026,31/02/2026,A,5,x1\n");
    expect(result.errors.map((e) => e.column)).toEqual(["txn_date", "value_date", "balance"]);
    expect(result.errors.every((e) => e.message.startsWith("row 1: "))).toBe(true);
  });

  it("one bad row never stops the others, and row numbers stay right", () => {
    const text = ["date,narration,credit,debit", "2026-10-01,A,1,", "2026-10-02,B,x,", "2026-10-03,C,3,", "bad,D,4,", "2026-10-05,E,,5"].join("\n");
    const result = parseStatementCsv(text);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 3, 5]);
    expect(result.errors.map((e) => [e.rowNumber, e.column])).toEqual([[2, "credit"], [4, "txn_date"]]);
    expect(result.errors[0].message).toBe("row 2: credit is not a number");
  });

  it("reports a quote that is never closed", () => {
    const result = parseStatementCsv('date,narration,credit\n2026-10-05,"open,1\n');
    expect(result.errors.some((e) => e.message.includes("never closed"))).toBe(true);
  });
});
