import { computeLateFee, defaultLateFeePolicy } from "../../billing/late-fee";
import { createPrng, type Prng } from "../../seed/prng";
import { type CalendarDate, addDays } from "../../time/calendar";
import { generateDemoDataset } from "../../seed/generate";
import type { Paise } from "../../money/money";
import type { FlatContext, OpenBill } from "../types";
import { buildPopulation, prepareBase, type Base, type Person, type Population } from "./population";
import type { Truth, TruthRow } from "./truth";

/** The day the demo society's bills are worked out as of. */
export const SOCIETY_DATE: CalendarDate = "2026-10-27";

export type Behaviour =
  | "EXACT_DUE" | "PRINCIPAL_ONLY" | "PART" | "TWO_MONTHS" | "ADVANCE" | "WRONG_AMOUNT" | "NEIGHBOUR" | "STALE_ORDER"
  | "NON_MAINTENANCE_CREDIT" | "DEBIT" | "CHEQUE_RETURN";

/**
 * What the payer does. Relative weights; the share is the weight over the total (98.5). Bills are only
 * paid by flats that have an open bill, each flat at most once per statement, so the weights of the
 * first eight (about 29% of rows) must fit in the 650 or so flats that owe something. If they run out,
 * the row becomes an ADVANCE.
 */
export const BEHAVIOUR_WEIGHTS: Readonly<Record<Behaviour, number>> = {
  EXACT_DUE: 14, // pays the exact due of the oldest bill
  PRINCIPAL_ONLY: 2.5, // forgot the late fee
  PART: 2.5, // pays part of it
  TWO_MONTHS: 2.5, // two months at once: MULTI_BILL, or ADVANCE when only one bill is open
  ADVANCE: 5, // k times a bill (2 to 6), for a flat that owes nothing
  WRONG_AMOUNT: 2.5, // an amount that is not the due and not the principal: AMBIGUOUS_INTENT
  NEIGHBOUR: 3, // pays the exact due of another flat's bill
  STALE_ORDER: 1.5, // a row dated before a payment already on the bill: AMBIGUOUS_INTENT
  NON_MAINTENANCE_CREDIT: 38, // vendor refund, hall rent, interest, a friend, an amount that happens to equal a due
  DEBIT: 25, // ATM, vendor payment, charges
  CHEQUE_RETURN: 2, // a returned cheque (a debit)
};

export type Style =
  | "CLEAN_CODE" | "MESSY_CODE" | "OTHER_FLAT_CODE" | "NAME_AND_UPI" | "UPI_ONLY" | "NAME_ONLY" | "NO_IDENTITY"
  | "TWO_CODES" | "NONEXISTENT_CODE" | "AMOUNT_ONLY";

/** How the narration names the payment, drawn separately from the behaviour. Relative weights (total 100). */
export const STYLE_WEIGHTS: Readonly<Record<Style, number>> = {
  CLEAN_CODE: 30, // T12-0408 in a common format
  MESSY_CODE: 15, // t12 408, T12-408, T12408, T12/0408, or one wrong digit
  OTHER_FLAT_CODE: 5, // the payer's own flat code when paying for a neighbour, else another flat's
  NAME_AND_UPI: 12, // the payer's name and UPI address, no code
  UPI_ONLY: 8, // the payer's UPI address only
  NAME_ONLY: 10, // the payer's name: full, cut short, an initial, with "Mr" or a bank prefix like MMT
  NO_IDENTITY: 8, // "maint" or nothing
  TWO_CODES: 3, // the flat and another flat
  NONEXISTENT_CODE: 3, // a well formed code of a flat that does not exist
  AMOUNT_ONLY: 6, // a reference and nothing else
};

export type Rail = "UPI" | "NEFT" | "IMPS" | "RTGS" | "CHEQUE" | "CASH";

/** How the money arrives. Cheque and cash rows carry no reference number. */
export const RAIL_WEIGHTS: Readonly<Record<Rail, number>> = { UPI: 58, NEFT: 15, IMPS: 10, RTGS: 3, CHEQUE: 8, CASH: 6 };

/** The statement dates, for rows that are not stale: the last seven days of October. */
const FIRST_DAY: CalendarDate = "2026-10-21";
const LAST_DAY: CalendarDate = SOCIETY_DATE;

export type SimulateOptions = {
  seed: number;
  rows: number;
  /** The dataset's flats; built from the default demo dataset (about 0.6 s) when not given. */
  base?: Base;
  /** Use this population (flats, people and who is registered) instead of drawing one from the seed. */
  population?: Population;
};

export type SimulatedStatement = {
  csvText: string;
  /** One entry per row of the CSV, credits and debits, numbered as the CSV reader numbers them. */
  truth: TruthRow[];
  flats: FlatContext[];
  population: Population;
};

export function defaultBase(): Base {
  return prepareBase(generateDemoDataset());
}

// ---------------------------------------------------------------- amounts

type DueInfo = { bill: OpenBill; outstanding: Paise; fee: Paise; due: Paise };

/** The open bills of a flat that still have principal unpaid on `asOf`, oldest first, with their fees. */
function dues(flat: FlatContext, asOf: CalendarDate): DueInfo[] {
  const result: DueInfo[] = [];
  for (const bill of [...flat.openBills].sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.billKey < b.billKey ? -1 : 1))) {
    const fee = computeLateFee({ billAmountPaise: bill.amountPaise, dueOn: bill.dueOn, asOf, payments: bill.paymentsOnBill.filter((p) => p.date <= asOf), holds: [], policy: defaultLateFeePolicy });
    if (fee.outstandingPaise > 0n) result.push({ bill, outstanding: fee.outstandingPaise, fee: fee.feePaise, due: fee.outstandingPaise + fee.feePaise });
  }
  return result;
}

const lastPaymentDate = (bill: OpenBill): CalendarDate => bill.paymentsOnBill.reduce((latest, p) => (p.date > latest ? p.date : latest), "0000-00-00");
const wholeRupees = (paise: Paise): Paise => (paise / 100n) * 100n;
const rupees = (n: number): Paise => BigInt(Math.round(n)) * 100n;

// ---------------------------------------------------------------- row plans

type Plan = {
  date: CalendarDate;
  credit: Paise;
  debit: Paise;
  truth: Truth;
  /** The flat the narration is about when it names one (the true flat), and the person who pays. */
  target: FlatContext | null;
  payer: Person | null;
  kind: "MAINTENANCE" | "OTHER_CREDIT" | "DEBIT" | "RETURN";
};

type Pools = { open: FlatContext[]; partial: FlatContext[]; none: FlatContext[]; any: FlatContext[] };

function pick<T>(rng: Prng, list: T[]): T {
  return rng.pick(list);
}

/** Takes a flat out of a pool at random, or null when it is empty. */
function take(rng: Prng, list: FlatContext[]): FlatContext | null {
  if (list.length === 0) return null;
  const i = rng.int(0, list.length - 1);
  return list.splice(i, 1)[0];
}

function dateFor(rng: Prng, floor: CalendarDate): CalendarDate {
  const day = addDays(FIRST_DAY, rng.int(0, 6));
  return day < floor ? floor : day > LAST_DAY ? LAST_DAY : day;
}

function personOf(rng: Prng, population: Population, flatCode: string): Person {
  const here = population.people.filter((p) => p.flatCode === flatCode);
  return here.length > 0 ? pick(rng, here) : pick(rng, population.people);
}

function payerOf(rng: Prng, population: Population, target: FlatContext, neighbour: boolean): Person {
  if (!neighbour) return personOf(rng, population, target.code);
  for (;;) {
    const other = pick(rng, population.people);
    if (other.flatCode !== target.code) return other;
  }
}

function planMaintenance(rng: Prng, behaviour: Behaviour, pools: Pools, population: Population): Plan {
  const asBill = (flat: FlatContext, kind: "PAYS_BILL" | "PARTIAL" | "MULTI_BILL" | "ADVANCE" | "AMBIGUOUS_INTENT", date: CalendarDate, credit: Paise, billKeys: string[], neighbour = false): Plan => ({
    date,
    credit,
    debit: 0n,
    truth: { kind, flatCode: flat.code, billKeys },
    target: flat,
    payer: payerOf(rng, population, flat, neighbour),
    kind: "MAINTENANCE",
  });

  if (behaviour === "ADVANCE") {
    const flat = (take(rng, pools.none) ?? take(rng, pools.any)) as FlatContext;
    const bill = population.billAmountByFlat.get(flat.code) ?? 600_000n;
    return asBill(flat, "ADVANCE", dateFor(rng, FIRST_DAY), bill * BigInt(rng.int(2, 6)), []);
  }
  if (behaviour === "STALE_ORDER") {
    const flat = take(rng, pools.partial);
    if (flat !== null) {
      const bill = [...flat.openBills].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))[0] as OpenBill;
      const issued = addDays(bill.dueOn, -9); // bills are issued nine days before they are due
      const latest = lastPaymentDate(bill);
      const earliest = addDays(latest, -rng.int(2, 10));
      const date = earliest < issued ? issued : earliest;
      const owed = date < latest ? dues(flat, date)[0] : undefined;
      if (owed !== undefined) return asBill(flat, "AMBIGUOUS_INTENT", date, owed.due, [owed.bill.billKey]);
    }
    return planMaintenance(rng, "ADVANCE", pools, population);
  }
  const flat = take(rng, pools.open) ?? take(rng, pools.partial);
  if (flat === null) return planMaintenance(rng, "ADVANCE", pools, population);
  // The payer pays on a day after the last payment already on the bill, so the bill's history is in order.
  const oldest = [...flat.openBills].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))[0];
  const date = dateFor(rng, lastPaymentDate(oldest));
  const owed = dues(flat, date);
  if (owed.length === 0) return planMaintenance(rng, "ADVANCE", pools, population);
  const first = owed[0];
  const key = first.bill.billKey;
  switch (behaviour) {
    case "EXACT_DUE":
      return asBill(flat, "PAYS_BILL", date, first.due, [key]);
    case "NEIGHBOUR":
      return asBill(flat, "PAYS_BILL", date, first.due, [key], true);
    case "PRINCIPAL_ONLY":
      return first.fee === 0n ? asBill(flat, "PAYS_BILL", date, first.due, [key]) : asBill(flat, "PARTIAL", date, first.outstanding, [key]);
    case "PART":
      return asBill(flat, "PARTIAL", date, wholeRupees((first.outstanding * BigInt(rng.int(20, 80))) / 100n) || 100n, [key]);
    case "TWO_MONTHS":
      return owed.length >= 2
        ? asBill(flat, "MULTI_BILL", date, first.due + owed[1].due, [key, owed[1].bill.billKey])
        : asBill(flat, "ADVANCE", date, first.due + first.bill.amountPaise, [key]);
    default: {
      // WRONG_AMOUNT: not the due and not the principal
      let amount = wholeRupees((first.due * BigInt(rng.int(20, 300))) / 100n);
      if (amount === first.due || amount === first.outstanding || amount <= 0n) amount = first.due + 100_000n;
      return asBill(flat, "AMBIGUOUS_INTENT", date, amount, [key]);
    }
  }
}

const VENDORS = ["SUNRISE TRADERS", "GREENLEAF GARDENS", "LIFTCARE SERVICES", "BRIGHTWAY ELECTRICALS", "CLEANWELL HOUSEKEEPING"];
const FRIENDS = ["rohan.p@oksbi", "meena.k@ybl", "sandeep99@paytm", "pooja.r@okaxis"];

function planOther(rng: Prng, behaviour: Behaviour, pools: Pools, population: Population): Plan {
  const date = dateFor(rng, FIRST_DAY);
  const none: Truth = { kind: "NOT_MAINTENANCE", flatCode: null, billKeys: [] };
  if (behaviour === "DEBIT") return { date, credit: 0n, debit: rupees(rng.int(100, 40_000)), truth: none, target: null, payer: null, kind: "DEBIT" };
  if (behaviour === "CHEQUE_RETURN") {
    return { date, credit: 0n, debit: rupees(rng.int(2_000, 20_000)), truth: { kind: "RETURN", flatCode: null, billKeys: [] }, target: null, payer: null, kind: "RETURN" };
  }
  // A credit that is not a maintenance payment. One in ten has an amount that happens to equal what a flat owes.
  const coincidence = rng.chance(0.1) && pools.open.length > 0;
  const owing = coincidence ? dues(pick(rng, pools.open), date)[0] : undefined;
  const credit = owing === undefined ? rupees(rng.int(100, 50_000)) : owing.due;
  return { date, credit, debit: 0n, truth: none, target: null, payer: personOf(rng, population, pick(rng, population.flats).code), kind: "OTHER_CREDIT" };
}

// ---------------------------------------------------------------- narration

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function codeText(rng: Prng, code: string, messy: boolean): string {
  const [, tower, number] = /^T(\d{2})-(\d{4})$/.exec(code) as RegExpExecArray;
  if (!messy) {
    return rng.weighted([
      { value: `T${tower}-${number}`, weight: 6 },
      { value: `T${tower} ${number}`, weight: 2 },
      { value: `T${tower}/${number}`, weight: 1 },
      { value: `FLAT T${tower}-${number}`, weight: 1 },
    ]);
  }
  const short = number.replace(/^0/, "");
  const digits = `${tower}${number}`;
  const typo = (): string => {
    const i = rng.int(0, digits.length - 1);
    const wrong = String((Number(digits[i]) + rng.int(1, 9)) % 10);
    const changed = `${digits.slice(0, i)}${wrong}${digits.slice(i + 1)}`;
    return `T${changed.slice(0, 2)}-${changed.slice(2)}`;
  };
  return rng.weighted([
    { value: `t${tower} ${short}`, weight: 3 },
    { value: `T${tower}-${short}`, weight: 3 },
    { value: `T${tower}${number}`, weight: 2 },
    { value: `T${tower}/${number}`, weight: 2 },
    { value: `t${Number(tower)}.${number}`, weight: 1 },
    { value: typo(), weight: 3 },
  ]);
}

const PLAIN_NOTES = ["maint", "maintenance", "mntc", "society dues", "flat maint", ""];

function nameText(rng: Prng, name: string): string {
  const upper = name.toUpperCase();
  const [first, ...rest] = upper.split(" ");
  const last = rest.join(" ") || first;
  return rng.weighted([
    { value: upper, weight: 4 },
    { value: `${last} ${first[0]}`, weight: 2 }, // SHAIKH A
    { value: `${first[0]} ${last}`, weight: 2 }, // A SHAIKH
    { value: `${first} ${last.slice(0, Math.max(4, last.length - 2))}`, weight: 2 }, // AAMIR SHAIK
    { value: `Mr ${upper}`, weight: 1 },
  ]);
}

function reference(rng: Prng, rail: Rail, index: number): string {
  const serial = pad(index, 5);
  if (rail === "UPI") return `4${pad(rng.int(0, 999_999), 6)}${serial}`;
  if (rail === "IMPS") return `5${pad(rng.int(0, 99_999), 5)}${serial}`;
  if (rail === "RTGS") return `HDFCR5${pad(rng.int(0, 999), 3)}${serial}${pad(rng.int(0, 99), 2)}`;
  return `N${pad(rng.int(10, 99), 2)}${pad(rng.int(0, 99_999), 5)}${serial}`; // NEFT
}

type Parts = { code: string[]; name: string | null; vpa: string | null; note: string };

function joinNarration(rng: Prng, rail: Rail, ref: string | null, parts: Parts): string {
  const sep = rng.pick(["/", "-", " ", "|"]);
  const body = [parts.name, parts.vpa, parts.code.length > 0 ? parts.code.join(rng.pick([" and ", " ", " / "])) : null, parts.note || null].filter((x): x is string => x !== null);
  if (rail === "CHEQUE") return [rng.pick(["CHQ DEP", "CHEQUE DEPOSIT", "CLG CHQ"]), ...body.filter((x) => x !== parts.name && x !== parts.vpa)].join(" ");
  if (rail === "CASH") return [rng.pick(["CASH DEP", "BY CASH", "CDM CASH DEP"]), ...body.filter((x) => x !== parts.name && x !== parts.vpa)].join(" ");
  const prefix = rail === "UPI" ? "UPI" : rail;
  return [prefix, ref, ...body].join(sep);
}

function fakeCode(rng: Prng, exists: ReadonlySet<string>): string {
  for (;;) {
    const code = `T${pad(rng.int(1, 28), 2)}-${pad(rng.int(1, 16), 2)}${pad(rng.int(1, 8), 2)}`;
    if (!exists.has(code)) return code;
  }
}

function otherCode(rng: Prng, population: Population, not: string[]): string {
  for (;;) {
    const flat = pick(rng, population.flats);
    if (!not.includes(flat.code)) return flat.code;
  }
}

function maintenanceNarration(rng: Prng, plan: Plan, style: Style, rail: Rail, ref: string, population: Population, exists: ReadonlySet<string>): { text: string; rail: Rail } {
  const target = plan.target as FlatContext;
  const payer = plan.payer as Person;
  const advance = plan.truth.kind === "ADVANCE" || plan.truth.kind === "MULTI_BILL";
  const note = advance && rng.chance(0.6) ? rng.pick(["adv", "advance", `${rng.int(2, 6)} months`, `${rng.int(2, 6)} mths`]) : rng.pick(PLAIN_NOTES);
  let railUsed = rail;
  const parts: Parts = { code: [], name: null, vpa: null, note };
  const maybeName = (): void => {
    if (rng.chance(0.5)) parts.name = nameText(rng, payer.name);
  };
  const maybeVpa = (): void => {
    if (railUsed === "UPI" && rng.chance(0.35)) parts.vpa = payer.upi;
  };
  switch (style) {
    case "CLEAN_CODE":
      parts.code = [codeText(rng, target.code, false)];
      maybeName();
      maybeVpa();
      break;
    case "MESSY_CODE":
      parts.code = [codeText(rng, target.code, true)];
      maybeName();
      maybeVpa();
      break;
    case "OTHER_FLAT_CODE":
      parts.code = [codeText(rng, payer.flatCode !== target.code ? payer.flatCode : otherCode(rng, population, [target.code]), false)];
      maybeName();
      break;
    case "NAME_AND_UPI":
      parts.name = nameText(rng, payer.name);
      if (railUsed === "UPI") parts.vpa = payer.upi;
      break;
    case "UPI_ONLY":
      railUsed = "UPI";
      parts.vpa = payer.upi;
      break;
    case "NAME_ONLY": {
      const bankPrefix = rng.chance(0.2);
      parts.name = nameText(rng, payer.name);
      if (bankPrefix) parts.name = `${rng.pick(["MMT", "NEFT", "TPT"])}/${parts.name}`;
      break;
    }
    case "NO_IDENTITY":
      if (rng.chance(0.3)) parts.note = "";
      break;
    case "TWO_CODES":
      parts.code = [codeText(rng, target.code, false), codeText(rng, otherCode(rng, population, [target.code]), false)];
      break;
    case "NONEXISTENT_CODE":
      parts.code = [codeText(rng, fakeCode(rng, exists), false)];
      break;
    case "AMOUNT_ONLY":
      parts.note = "";
      break;
  }
  return { text: joinNarration(rng, railUsed, railUsed === "CHEQUE" || railUsed === "CASH" ? null : ref, parts), rail: railUsed };
}

function otherNarration(rng: Prng, plan: Plan, ref: string, population: Population, exists: ReadonlySet<string>): string {
  const payer = plan.payer;
  if (plan.kind === "DEBIT") {
    return rng.weighted([
      { value: `ATM WDL ${ref}`, weight: 2 },
      { value: `NEFT-${ref}-${rng.pick(VENDORS)}-PAYMENT`, weight: 3 },
      { value: `UPI/${ref}/${rng.pick(VENDORS).toLowerCase().replace(/ /g, "")}@ybl/bill`, weight: 3 },
      { value: "SMS CHARGES", weight: 1 },
      { value: `CHQ PAID ${ref.slice(-6)}`, weight: 1 },
    ]);
  }
  if (plan.kind === "RETURN") return `CHQ RET ${ref.slice(-6)} INSUFFICIENT FUNDS${rng.chance(0.4) ? ` ${otherCode(rng, population, [])}` : ""}`;
  const withCode = rng.chance(0.2) ? ` ${codeText(rng, rng.chance(0.8) ? otherCode(rng, population, []) : fakeCode(rng, exists), false)}` : "";
  return rng.weighted([
    { value: `NEFT-${ref}-${rng.pick(VENDORS)}-REFUND`, weight: 35 },
    { value: `IMPS/${ref}/${(payer?.name ?? "RAVI PAWAR").toUpperCase()}/HALL RENT${withCode}`, weight: 25 },
    { value: `INT.PD 01-07-2026 TO 30-09-2026`, weight: 10 },
    { value: `UPI/${ref}/${rng.pick(FRIENDS)}/dinner split${withCode}`, weight: 20 },
    { value: `UPI/${ref}/stranger${rng.int(1, 99)}@oksbi/gift`, weight: 10 },
  ]);
}

// ---------------------------------------------------------------- the statement

const csvCell = (text: string): string => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
const money = (paise: Paise): string => (paise === 0n ? "" : `${paise / 100n}.${pad(Number(paise % 100n), 2)}`);

export function csvOf(lines: readonly { date: CalendarDate; narration: string; credit: Paise; debit: Paise }[]): string {
  return ["Txn Date,Narration,Credit,Debit", ...lines.map((l) => `${l.date},${csvCell(l.narration)},${money(l.credit)},${money(l.debit)}`)].join("\n") + "\n";
}

/**
 * A synthetic bank statement of `rows` rows for the demo society as of 2026-10-27, with the truth of every row.
 * Everything is drawn from `seed`, so the same options give the same bytes. The behaviours, narration
 * styles and rails and their weights are BEHAVIOUR_WEIGHTS, STYLE_WEIGHTS and RAIL_WEIGHTS. The
 * behaviour is drawn first and fixes the truth; the style and the rail are drawn after and cannot change it.
 */
export function simulateStatement(options: SimulateOptions): SimulatedStatement {
  const rng = createPrng(options.seed);
  const base = options.base ?? defaultBase();
  const population = options.population ?? buildPopulation(base, rng.fork("population"));
  const exists = new Set(population.flats.map((f) => f.code));
  const shuffled = (list: FlatContext[]): FlatContext[] => rng.fork("pools").shuffle(list);
  // A flat is "partial" when payments are already on its OLDEST open bill: only then is a row dated before one of them stale.
  const oldestHasPayment = (f: FlatContext): boolean => [...f.openBills].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))[0]?.paymentsOnBill.length > 0;
  const pools: Pools = {
    open: shuffled(population.flats.filter((f) => f.openBills.length > 0 && !oldestHasPayment(f))),
    partial: shuffled(population.flats.filter((f) => f.openBills.length > 0 && oldestHasPayment(f))),
    none: shuffled(population.flats.filter((f) => f.openBills.length === 0)),
    any: shuffled([...population.flats]),
  };
  const draw = rng.fork("rows");
  const behaviours = Object.entries(BEHAVIOUR_WEIGHTS).map(([value, weight]) => ({ value: value as Behaviour, weight }));
  const styles = Object.entries(STYLE_WEIGHTS).map(([value, weight]) => ({ value: value as Style, weight }));
  const rails = Object.entries(RAIL_WEIGHTS).map(([value, weight]) => ({ value: value as Rail, weight }));

  const made: { date: CalendarDate; narration: string; credit: Paise; debit: Paise; truth: Truth }[] = [];
  for (let i = 0; i < options.rows; i++) {
    const behaviour = draw.weighted(behaviours);
    const plan = behaviour === "NON_MAINTENANCE_CREDIT" || behaviour === "DEBIT" || behaviour === "CHEQUE_RETURN"
      ? planOther(draw, behaviour, pools, population)
      : planMaintenance(draw, behaviour, pools, population);
    const style = draw.weighted(styles);
    const rail = draw.weighted(rails);
    const ref = reference(draw, rail === "CHEQUE" || rail === "CASH" ? "NEFT" : rail, i);
    const narration = plan.kind === "MAINTENANCE"
      ? maintenanceNarration(draw, plan, style, rail, ref, population, exists).text
      : otherNarration(draw, plan, plan.kind === "RETURN" || plan.kind === "DEBIT" ? ref : reference(draw, "NEFT", i), population, exists);
    made.push({ date: plan.date, narration, credit: plan.credit, debit: plan.debit, truth: plan.truth });
  }
  // A statement runs by date; the order within a day is the order they were drawn in.
  const ordered = made.map((row, index) => ({ row, index })).sort((a, b) => (a.row.date === b.row.date ? a.index - b.index : a.row.date < b.row.date ? -1 : 1)).map((x) => x.row);
  return {
    csvText: csvOf(ordered),
    truth: ordered.map((row, i) => ({ rowNumber: i + 1, truth: row.truth })),
    flats: population.flats,
    population,
  };
}

/** The same rows in a random order, numbered by their new position. The truth follows its row. */
export function shuffleStatement(statement: SimulatedStatement, seed: number): SimulatedStatement {
  const lines = statement.csvText.trimEnd().split("\n");
  const [header, ...data] = lines;
  const order = createPrng(seed).shuffle(data.map((_, i) => i));
  return {
    ...statement,
    csvText: [header, ...order.map((i) => data[i])].join("\n") + "\n",
    truth: order.map((original, i) => ({ rowNumber: i + 1, truth: statement.truth[original].truth })),
  };
}

/**
 * Two statements of `rows` rows from the same population. The second repeats the last `overlap` rows of the first
 * (the same lines, so the same payments) after its own new rows.
 */
export function simulateOverlappingStatements(options: SimulateOptions & { overlap: number }): { first: SimulatedStatement; second: SimulatedStatement } {
  const first = simulateStatement(options);
  const own = simulateStatement({ ...options, seed: options.seed + 1, rows: options.rows - options.overlap, population: first.population });
  const firstLines = first.csvText.trimEnd().split("\n").slice(1);
  const repeated = firstLines.slice(firstLines.length - options.overlap);
  const ownLines = own.csvText.trimEnd().split("\n");
  return {
    first,
    second: {
      ...own,
      csvText: [...ownLines, ...repeated].join("\n") + "\n",
      truth: [...own.truth, ...first.truth.slice(firstLines.length - options.overlap).map((t, i) => ({ rowNumber: own.truth.length + i + 1, truth: t.truth }))],
    },
  };
}
