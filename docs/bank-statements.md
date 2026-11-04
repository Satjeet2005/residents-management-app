# Bank statements: import schema and narration parser

Staff upload a bank statement as a CSV file. Real statements are free text, and every
bank lays them out differently, so the work is in two layers:

1. **The canonical import schema** (`src/domain/matching/csv.ts`). It turns a file into
   rows with fixed fields, or into row errors. It does not read meaning into the narration.
2. **The narration parser** (`src/domain/matching/narration.ts`, with `flat-code.ts` and
   `names.ts`). It reads one free-text narration and returns the facts in it: the rail, a
   reference, a UPI address, a payer name, flat codes and hints.

The matcher (a later task, T7b) uses only the parsed fields and the canonical row. It never
reads raw text. Decision D7 in `docs/decisions.md` is the design this implements.

> **Every narration format on this page is a SYNTHETIC ASSUMPTION.** None of them is a
> specification of a real bank, of UPI, NEFT, IMPS or RTGS. They were written to look like
> what such narrations commonly contain. The parser looks for tokens and separators and does
> not depend on one layout, but no real statement has been tested against it.

Everything here is pure TypeScript in `src/domain/matching`: no Node built-ins, no `Intl`,
no randomness and no clock (`tests/domain/matching/purity.test.ts`).

## Canonical schema

`parseStatementCsv(text)` returns `{ rows, errors, headerMap, ignoredColumns }`.

| Column | Required | Meaning |
|---|---|---|
| `txn_date` | yes | The date of the transaction. |
| `value_date` | no | The bank's value date. |
| `narration` | yes | The bank's free text, kept exactly as written (never trimmed). |
| `credit` | one of credit or debit | Money in, in rupees. Blank means 0. |
| `debit` | one of credit or debit | Money out, in rupees. Blank means 0. |
| `balance` | no | Running balance, in rupees. |
| `reference` | no | The bank's own reference or cheque number, as text. |

A `StatementRow` has: `rowNumber`, `txnDate` (`YYYY-MM-DD`), `valueDate | null`,
`narrationRaw`, `creditPaise`, `debitPaise`, `balancePaise | null` and `reference | null`.
Amounts are integer paise (`bigint`), read with `parseRupees`, so `1,06,468`, `1,234.5` and
`₹98.43` work and `1.234`, `-5` and `5O0` are errors.

### Reading the file

An RFC 4180 subset, written by hand: commas; quoted fields that hold commas, line breaks
and doubled quotes (`""`); CRLF, LF or a lone CR; a UTF-8 byte order mark; blank lines and
lines of only commas are skipped; trailing commas are fine.

### Header aliases

Headers are compared after trimming, lower-casing, and turning underscores and runs of
spaces into one space.

| Canonical column | Accepted headers |
|---|---|
| `txn_date` | `txn_date`, `txn date`, `date`, `transaction date` |
| `value_date` | `value_date`, `value date`, `value dt` |
| `narration` | `narration`, `description`, `particulars`, `remarks` |
| `credit` | `credit`, `deposit`, `deposits`, `cr`, `credit amount` |
| `debit` | `debit`, `withdrawal`, `withdrawals`, `dr`, `debit amount` |
| `balance` | `balance`, `closing balance` |
| `reference` | `reference`, `ref`, `ref no`, `chq no`, `cheque number` |

A header that matches nothing, or repeats a column already mapped, is ignored and listed in
`ignoredColumns`. A missing required column is a fatal error: `errors` holds one entry per
missing column with `rowNumber` 0 and a message starting `header:`, and no row is read.

### Date formats

`YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY` (the day and month may have one digit) and
`DD-Mon-YYYY` (`Jan` to `Dec`, any case). Two-digit years are rejected. The date is checked
with the calendar helper, so `31-04-2026` and `29-02-2027` are errors.

### Row errors

A row has an error when a date or amount cannot be read, or when it does not have exactly one
positive side: both credit and debit positive, or neither. An error is
`{ rowNumber, column, message }`, for example `row 14: credit is not a number`. One bad row
never stops the others, and a bad row is not returned in `rows`.

## Narration parser

`parseNarration(raw)` returns:

| Field | Meaning |
|---|---|
| `rail` | `UPI`, `NEFT`, `IMPS`, `RTGS`, `CHEQUE_DEPOSIT`, `CHEQUE_RETURN`, `CASH_DEPOSIT`, `BANK_CHARGE`, `INTEREST` or `UNKNOWN`. |
| `reference` | A UPI 12-digit reference, a NEFT or RTGS UTR, an IMPS reference or a cheque number. |
| `vpa` | A UPI address such as `aamir.s@oksbi`, lower case. |
| `remitterName` | The payer's name, upper case, punctuation removed, spaces collapsed. It may be cut short. |
| `flatTokens` | Flat codes found (see below), each with `ambiguous` and the text it came from. |
| `hints` | `maintenance`, `rent`, `advance`: whether such a word appears. |
| `months` | A month count from notes such as `3 months` or `3 mths` (1 to 24), else null. |
| `notes` | The words left over, upper case. Empty for `UNKNOWN`. |

It never throws, for any string, and it never changes the text it is given.

### Synthetic narration families

| Rail | Example (synthetic) | What is read |
|---|---|---|
| UPI | `UPI/402200118877/aamir.s@oksbi/maintenance` | reference `402200118877`, address, hint |
| UPI | `UPI-402200118877-AAMIR SHAIKH-aamir.s@oksbi-T21 1601` | also name `AAMIR SHAIKH`, flat `T21-1601` |
| UPI | `UPI 402200118877 T07-1203 maint` | space-separated, flat, hint |
| NEFT | `NEFT-N30112345-SHARMA R-T12 408` | UTR `N30112345`, name, flat `T12-0408` |
| NEFT | `NEFT/N30112346/GUPTA AND SONS/T15-0902 3 months` | months 3 |
| IMPS | `IMPS/5088123456/RAHUL KULKAR/maint T03 702` | reference `5088123456`, flat `T03-0702` |
| RTGS | `RTGS-HDFCR52026102712345-A SHAIKH-T21-1601 ADV` | UTR, advance hint |
| Cheque | `CHQ DEP 004512`, `CHEQUE DEPOSIT 004513 T18 1105` | cheque number, flat |
| Cheque return | `CHQ RET 004512 INSUFFICIENT FUNDS` | cheque number, note |
| Cash | `CASH DEP T12-0408` | flat |
| Interest | `INT.PD 01-07-2026 TO 30-09-2026` | rail only |
| Charges | `SMS CHARGES` | rail only |

Separators `/`, `-`, `*`, `|` and spaces are tolerated, mixed. `tests/domain/matching/narration.test.ts`
has a table of 74 narrations in these families, with many more spellings of each, and a fuzz test in `properties.test.ts`.

How each part is decided:

- **Rail**: the rail keyword that appears first in the text wins. Cheque returns, bank charges,
  interest, cash and cheque deposits are checked before UPI, NEFT, IMPS and RTGS on a tie.
- **Reference**: UPI is a run of exactly 12 digits. NEFT and RTGS are the first word of 8 to
  22 letters and digits with at least one letter and 6 digits. IMPS is 8 to 12 digits. A
  cheque number is 6 digits. **A 12-digit number is a UPI reference only when the rail is
  UPI.** On any other rail, or with no rail, it is just a number.
- **UPI address**: letters, digits, `.` and `_`, then `@`, then letters. It is removed from
  the text before anything else is read, so a flat code inside an address is not read.
- **Name**: the first run of words made of letters that are not rail words, purpose words
  (`maint`, `rent`, `flat`, `months`, ...) or numbers, and that has a word of 3 or more letters
  other than `AND`. Only for UPI, NEFT, IMPS and RTGS.
- **Months**: a number from 1 to 24 followed by `month(s)`, `mth(s)`, `mnth(s)` or `mo(s)`.

### Flat codes (`flat-code.ts`)

A flat code is `T{tower}-{floor}{unit}`, such as `T12-0408`: tower 01 to 28, floor 01 to 16,
unit 01 to 08. This layout is a synthetic assumption.

`extractFlatTokens` needs the letter `T` (or `t`) that is not inside a word or a longer
number, then a tower of 1 or 2 digits and a number of 3 or 4 digits, with at most one
separator (space, `-`, `/`, `_`, `.`) or none between them. It reads the text two ways:
split where the separator is, and as one run of digits split after a 1 or 2 digit tower.
Each reading must pass the range rules. One valid code is returned with `ambiguous: false`.
Two or more are all returned with `ambiguous: true` (`T1 1101` is `T01-1101` or `T11-0101`).

These resolve to `T12-0408`: `T12-0408`, `t12 0408`, `T12/408`, `T12_408`, `T12.0408`,
`T120408`, `T12408`, `FLAT T12 408`, `T-12-0408`.

These never give a flat code: phone numbers, UPI references, UTRs, dates, amounts, cheque
numbers, and codes with a tower above 28, a floor above 16 or a unit above 08
(`tests/domain/matching/flat-code.test.ts` lists 41 such strings).

### Names (`names.ts`)

`nameMatchStrength(remitter, residentName)` returns:

- `EXACT`: the same words in any order.
- `TRUNCATED`: the words pair up and one is cut short, a prefix of 4 or more letters
  (`RAHUL KULKAR` for `Rahul Kulkarni`).
- `INITIAL`: the words pair up and one is an initial (`AAMIR S` for `Aamir Shaikh`).
- `NONE`: anything else.

Honorifics (`MR`, `MRS`, `MS`, `MISS`, `SHRI`, `SMT`, `DR`) are ignored. **A name alone is never
enough to identify a flat**: people share names, a payer can pay for someone else, and banks
cut names. A name can only support a match that another signal already points to.

### Duplicate keys (`dedupe.ts`)

`rowDedupeKey(row, parsed, occurrence)` is a readable string under 200 characters.

- With a reference: `ref|<rail>|<reference>|<credit paise>|<debit paise>`. The same payment
  in two overlapping statements gets the same key, whatever the narration spelling.
- Without one: `row|<date>|<credit>|<debit>|<narration, normalised, first 80 characters>|<balance or nobal>|<occurrence>`.
  The caller counts `occurrence`: 1 for the first such row in a file, 2 for the second
  identical one. Two identical cash deposits are two payments and get two keys.

## What this does not do

- It does not match a row to a flat, post anything, or decide anything. That is T7b.
- It does not check that balances follow from one row to the next, or that a file is complete
  (completeness checks are cut, D7).
- It does not read Excel, PDF, semicolon or tab separated files, or text in other encodings.
- It does not guess between `DD/MM/YYYY` and `MM/DD/YYYY`; it reads day first.
- It does not read a `Cr` or `Dr` suffix on an amount, or currency words such as `Rs`.
- It does not read names written in Devanagari, though flat codes, references and rails are
  still found in text that holds Devanagari.
- It does not read past the first 1,000 characters of a narration.

## Assumptions

- **B1.** Every narration family and flat layout above is synthetic. No real bank was used.
- **B2.** The header aliases are the list above and nothing more.
- **B3.** `rowNumber` counts non-blank data rows from 1, so a blank line does not use a number.
- **B4.** A row with an empty narration is accepted, so that its money is not lost; it ends up with rail `UNKNOWN` and waits for a person.
- **B5.** A balance that cannot be read makes the row an error. A blank balance is fine.
- **B6.** A date is read day first, and `01/02/2026` is 1 February.
- **B7.** The T prefix is required for a flat code. Without it too many numbers would look like flats.
- **B8.** An explicit separator does not stop the joined reading, so `T1 2408` gives `T12-0408` when the split reading is out of range.
- **B9.** A flat code inside a UPI address is not read.
- **B10.** Only the first 1,000 characters of a narration are read.
- **B11.** Cheque numbers are 6 digits; NEFT and RTGS references need a letter, so a bare 12-digit number is never one.
- **B12.** The rail keyword that comes first in the text decides the rail.
- **B13.** A remitter name is the first name-like run, only on UPI, NEFT, IMPS and RTGS, and it is a candidate to be checked, not a fact. A prefix word the bank adds (such as `MMT`) can be taken for a name.
- **B14.** A month count above 24 is not a count.
- **B15.** `nameMatchStrength` needs the same number of words on both sides (at most 6), and at least one pair that is a whole word or a cut-short word. `SHARMA` against `Sharman` is `TRUNCATED`, because a single word of 4 or more letters can be a prefix.
- **B16.** The dedupe key includes both amounts when there is a reference, because cheque numbers are only unique within one bank, and the spec asked only for the rail and reference.
