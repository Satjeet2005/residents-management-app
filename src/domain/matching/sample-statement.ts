import type { DemoDataset } from "../seed/types";
import { generateDemoDataset } from "../seed/generate";
import { prepareBase } from "./benchmark/population";
import { simulateStatement } from "./benchmark/simulate";

/** The flats the hand-written rows are about. The simulated rows never use them, so a hand-written row decides alone. */
const HAND_FLATS = new Set(["T12-0408", "T21-1601", "T15-0902", "T07-1203", "T03-0702", "T18-1105", "T26-0301"]);

/** The simulator is asked for more rows than are kept, because a few of its rows are dated before the statement window (stale ones). */
const SIMULATED_DRAWN = 125;
/** How many simulated rows are kept, all dated inside the window. */
const SIMULATED_KEPT = 100;
const FIRST_DAY = "2026-10-20";
const LAST_DAY = "2026-10-27";
const SIMULATED_SEED = 20261027;

/**
 * The rows written by hand, each about one thing the demo should show (see docs/statement-import-design.md for what each becomes).
 * Flat codes, names and amounts are the demo dataset's, as of 27 October 2026: T12-0408 owes ₹6,468, T21-1601 owes ₹5,698 of which
 * ₹5,660 is principal, T15-0902 owes ₹8,713 on its oldest bill, T07-1203 has paid up, and three look-alike flats owe ₹10,720 each.
 */
const HAND_ROWS: readonly string[] = [
  // Pays exactly what is due, with the flat code and a resident's name: posted automatically.
  "2026-10-27,UPI/710000000001/T12-0408 Swati Joshi/maintenance,6468.00,",
  // The oldest bill of a flat with two open bills, exactly: posted automatically, the second bill stays open.
  "2026-10-27,UPI/710000000002/T15-0902 Rohit Deshmukh/maintenance,8713.00,",
  // Pays only the principal: ₹38 of late fee would remain, so a person decides.
  "2026-10-27,UPI/710000000003/T21-1601 Aamir Shaikh/maintenance,5660.00,",
  // The look-alike case: no flat code, the amount ₹10,720 is what three different flats owe.
  "2026-10-27,UPI/710000000004/PAYMENT FOR FLAT MAINTENANCE,10720.00,",
  // A typo in the flat code (unit 10 does not exist): no flat can be read.
  "2026-10-26,UPI/710000000005/T21-1610 Aamir S/maintenance,5698.00,",
  // A cheque with no name and no flat.
  "2026-10-24,CHQ DEP 482913 CLEARING,8000.00,",
  // An advance: a flat that has paid up pays three months at once.
  "2026-10-25,UPI/710000000006/T07-1203 Neeraj Kulkarni/advance 3 months maintenance,22425.00,",
  // A payment above the approval threshold (₹25,000 or more is never posted by itself).
  "2026-10-23,NEFT/N710000000007/T15-0902 Rohit Deshmukh/maintenance,30000.00,",
  // Money going out, interest and a bank charge: not maintenance.
  "2026-10-22,NEFT/ACME HOUSEKEEPING/INV 2210 SEPTEMBER,,48500.00",
  "2026-10-24,NEFT/POWER BOARD/ELECTRICITY OCT,,17250.00",
  "2026-10-21,INT PD 01-07-2026 TO 30-09-2026,1316.00,",
  "2026-10-20,SMS CHARGES Q2,,59.00",
  // Two identical cash deposits: two payments, so two rows, with nothing to say who paid.
  "2026-10-25,BY CASH DEPOSIT CDM 220117,1500.00,",
  "2026-10-25,BY CASH DEPOSIT CDM 220117,1500.00,",
];

const dateOf = (line: string): string => line.slice(0, 10);

/**
 * The sample bank statement of the demo: about 115 rows dated 20 to 27 October 2026, as CSV text. Fourteen are written by hand (above)
 * and the rest come from the benchmark simulator on the demo flats (without the hand-written ones' flats), so the statement has the mess
 * of a real one: UPI, NEFT, IMPS, cheques and cash, flat codes written many ways, names cut short, debits and charges. It is
 * deterministic: the same bytes every time. `src/server/statements/sample-statement.ts` holds a copy and a test fails when they differ.
 */
export function buildSampleStatement(dataset: DemoDataset = generateDemoDataset()): string {
  const base = prepareBase(dataset);
  const simulated = simulateStatement({ seed: SIMULATED_SEED, rows: SIMULATED_DRAWN, base: { ...base, flats: base.flats.filter((f) => !HAND_FLATS.has(f.code)) } });
  const [header, ...lines] = simulated.csvText.trimEnd().split("\n");
  const inWindow = lines.filter((line) => dateOf(line) >= FIRST_DAY && dateOf(line) <= LAST_DAY).slice(0, SIMULATED_KEPT);
  const all = [...inWindow, ...HAND_ROWS].map((line, index) => ({ line, index }));
  // By date, the order within a day being the order they were made in (simulated rows first, then the hand-written ones).
  all.sort((a, b) => (dateOf(a.line) === dateOf(b.line) ? a.index - b.index : dateOf(a.line) < dateOf(b.line) ? -1 : 1));
  return `${[header, ...all.map((x) => x.line)].join("\n")}\n`;
}
