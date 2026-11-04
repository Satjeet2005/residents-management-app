import { parseRupees, type Paise } from "../money/money";
import { isValidDate, type CalendarDate } from "../time/calendar";

/** One data row of a bank statement, in the canonical shape. Amounts are integer paise. */
export type StatementRow = {
  /** 1-based position among the non-blank data rows, so the first data row is 1. */
  rowNumber: number;
  txnDate: CalendarDate;
  valueDate: CalendarDate | null;
  /** The narration exactly as it appears in the file: never trimmed or changed. */
  narrationRaw: string;
  creditPaise: Paise;
  debitPaise: Paise;
  balancePaise: Paise | null;
  reference: string | null;
};

/** A problem with one row (rowNumber 1 and up) or with the header (rowNumber 0). */
export type RowError = { rowNumber: number; column: string; message: string };

export type StatementCsvResult = {
  rows: StatementRow[];
  errors: RowError[];
  /** Each recognised header as written (trimmed) mapped to its canonical column. */
  headerMap: Record<string, string>;
  /** Headers that were not recognised, or that repeat a column already mapped. They are ignored. */
  ignoredColumns: string[];
};

/** Header aliases, looked up after lower-casing and turning underscores and runs of spaces into one space. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ...["txn date", "date", "transaction date"].map((a) => [a, "txn_date"] as const),
  ...["value date", "value dt"].map((a) => [a, "value_date"] as const),
  ...["narration", "description", "particulars", "remarks"].map((a) => [a, "narration"] as const),
  ...["credit", "deposit", "deposits", "cr", "credit amount"].map((a) => [a, "credit"] as const),
  ...["debit", "withdrawal", "withdrawals", "dr", "debit amount"].map((a) => [a, "debit"] as const),
  ...["balance", "closing balance"].map((a) => [a, "balance"] as const),
  ...["reference", "ref", "ref no", "chq no", "cheque number"].map((a) => [a, "reference"] as const),
]);

const headerKey = (header: string): string => header.trim().toLowerCase().replace(/[_\s]+/g, " ");

const MONTHS: ReadonlyMap<string, number> = new Map(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i + 1] as const),
);

const pad = (value: number | string, width: number): string => String(value).padStart(width, "0");

/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY and DD-Mon-YYYY (any case). Two-digit years and impossible dates give null. */
export function parseStatementDate(text: string): CalendarDate | null {
  const value = text.trim();
  let candidate: string | null = null;
  let match: RegExpExecArray | null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    candidate = value;
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value)) !== null) {
    candidate = `${match[3]}-${pad(match[2], 2)}-${pad(match[1], 2)}`;
  } else if ((match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value)) !== null) {
    const month = MONTHS.get(match[2].toLowerCase());
    if (month !== undefined) candidate = `${match[3]}-${pad(month, 2)}-${pad(match[1], 2)}`;
  }
  return candidate !== null && isValidDate(candidate) ? candidate : null;
}

/** Splits CSV text into records of fields. Blank records are dropped. `unterminated` is true if a quote was never closed. */
function readRecords(input: string): { records: string[][]; unterminated: boolean } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  const endRecord = () => {
    record.push(field);
    field = "";
    if (record.some((f) => f.trim() !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else field += c;
  }
  if (field !== "" || record.length > 0) endRecord();
  return { records, unterminated: inQuotes };
}

/** Reads one amount cell. Blank is 0n. Returns null (and records the error) when the text is not a valid amount. */
function readAmount(text: string, column: string, rowNumber: number, errors: RowError[]): Paise | null {
  const value = text.trim();
  if (value === "") return 0n;
  const fail = (message: string): null => {
    errors.push({ rowNumber, column, message: `row ${rowNumber}: ${column} ${message}` });
    return null;
  };
  if (/^[+\-−]/.test(value)) return fail("must not be negative or carry a sign");
  if (/\.\d{3,}$/.test(value)) return fail("has more than 2 decimal places");
  try {
    return parseRupees(value);
  } catch {
    return fail("is not a number");
  }
}

/**
 * Reads a statement CSV (RFC 4180 subset) into canonical rows. A bad row is
 * reported in `errors` and skipped; it never stops the other rows. A missing
 * required column is reported as an error on row 0 and no row is read.
 */
export function parseStatementCsv(text: string): StatementCsvResult {
  const { records, unterminated } = readRecords(text);
  const rows: StatementRow[] = [];
  const errors: RowError[] = [];
  const headerMap: Record<string, string> = {};
  const ignoredColumns: string[] = [];
  const result = (): StatementCsvResult => ({ rows, errors, headerMap, ignoredColumns });

  if (records.length === 0) {
    errors.push({ rowNumber: 0, column: "header", message: "header: the file has no header row" });
    return result();
  }

  const columnAt = new Map<string, number>();
  records[0].forEach((header, index) => {
    const canonical = ALIASES.get(headerKey(header));
    if (canonical !== undefined && !columnAt.has(canonical)) {
      columnAt.set(canonical, index);
      headerMap[header.trim()] = canonical;
    } else if (header.trim() !== "") ignoredColumns.push(header.trim());
  });

  for (const required of ["txn_date", "narration"]) {
    if (!columnAt.has(required)) errors.push({ rowNumber: 0, column: required, message: `header: required column ${required} is missing` });
  }
  if (!columnAt.has("credit") && !columnAt.has("debit")) {
    errors.push({ rowNumber: 0, column: "credit", message: "header: needs a credit column, a debit column or both" });
  }
  if (errors.length > 0) return result();

  const cell = (fields: string[], column: string): string => {
    const index = columnAt.get(column);
    return index === undefined ? "" : (fields[index] ?? "");
  };

  records.slice(1).forEach((fields, offset) => {
    const rowNumber = offset + 1;
    const before = errors.length;
    const fail = (column: string, message: string) => errors.push({ rowNumber, column, message: `row ${rowNumber}: ${column} ${message}` });

    const txnDate = parseStatementDate(cell(fields, "txn_date"));
    if (txnDate === null) fail("txn_date", "is not a valid date (use YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or DD-Mon-YYYY)");
    const valueText = cell(fields, "value_date");
    const valueDate = valueText.trim() === "" ? null : parseStatementDate(valueText);
    if (valueText.trim() !== "" && valueDate === null) fail("value_date", "is not a valid date (use YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or DD-Mon-YYYY)");

    const creditPaise = readAmount(cell(fields, "credit"), "credit", rowNumber, errors);
    const debitPaise = readAmount(cell(fields, "debit"), "debit", rowNumber, errors);
    if (creditPaise !== null && debitPaise !== null && (creditPaise > 0n) === (debitPaise > 0n)) {
      fail("credit", creditPaise > 0n ? "and debit are both positive; a row has one side only" : "and debit are both empty; a row needs an amount");
    }
    const balanceText = cell(fields, "balance");
    const balancePaise = balanceText.trim() === "" ? null : readAmount(balanceText, "balance", rowNumber, errors);

    if (errors.length > before || txnDate === null || creditPaise === null || debitPaise === null) return;
    const reference = cell(fields, "reference").trim();
    rows.push({ rowNumber, txnDate, valueDate, narrationRaw: cell(fields, "narration"), creditPaise, debitPaise, balancePaise, reference: reference === "" ? null : reference });
  });

  if (unterminated) errors.push({ rowNumber: records.length - 1, column: "narration", message: `row ${records.length - 1}: a quoted field is never closed` });
  return result();
}
