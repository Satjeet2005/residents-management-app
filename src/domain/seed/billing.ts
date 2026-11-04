import { computeLateFee, defaultLateFeePolicy } from "../billing/late-fee";
import type { Paise } from "../money/money";
import { type CalendarDate, addDays, diffDays } from "../time/calendar";
import type { Prng } from "./prng";
import {
  DEMO_AS_OF,
  DEMO_PERIODS,
  type DemoBill,
  type DemoFlat,
  type DemoLedgerEntry,
  RATE_PAISE_PER_SQFT,
} from "./types";

type Outcome = "ON_TIME" | "LATE" | "PARTIAL" | "UNPAID";
type PaymentMode = "UPI" | "NEFT" | "CHQ";

/** Probabilities per period, in the order on time / late / partial / unpaid. */
export const OUTCOME_WEIGHTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "2026-10-01": [0.7, 0.1, 0.04, 0.16],
  "2026-09-01": [0.72, 0.18, 0.03, 0.07],
  "2026-08-01": [0.74, 0.2, 0.02, 0.04],
  "2026-07-01": [0.75, 0.22, 0.01, 0.02],
  "2026-06-01": [0.75, 0.23, 0.01, 0.01],
};

/** Day offsets from the issue date (the 1st) to the 10th; the first five days carry most of the weight. */
const ON_TIME_OFFSETS = Array.from({ length: 10 }, (_, offset) => ({ value: offset, weight: offset < 5 ? 5 : 1 }));
const PAYMENT_MODES: readonly { value: PaymentMode; weight: number }[] = [
  { value: "UPI", weight: 70 },
  { value: "NEFT", weight: 20 },
  { value: "CHQ", weight: 10 },
];

const DUE_DAY_OFFSET = 9;
const LATE_PAYMENT_WINDOW_DAYS = 45;
const PARTIAL_PAYMENT_WINDOW_DAYS = 20;

type Forced =
  | { kind: "NO_BILL" }
  | { kind: "UNPAID" }
  | { kind: "ON_TIME"; day: number }
  | { kind: "PART"; dueOn: CalendarDate; date: CalendarDate; amountPaise: Paise };

type Plan =
  | { kind: "UNPAID" }
  | { kind: "FULL"; date: CalendarDate; mode: PaymentMode }
  | { kind: "FULL_LATE"; date: CalendarDate; mode: PaymentMode }
  | { kind: "PART"; date: CalendarDate; mode: PaymentMode; amountPaise: Paise };

const UNPAID: Forced = { kind: "UNPAID" };
const paidOnTime = (periods: readonly CalendarDate[], day: number): Record<string, Forced> =>
  Object.fromEntries(periods.map((period) => [period, { kind: "ON_TIME", day } as Forced]));

const [JUN, JUL, AUG, SEP, OCT] = DEMO_PERIODS;

/** Fixed scenarios for the sample flats. They use no random draws, so they are the same on every seed. */
const FORCED: Readonly<Record<string, Readonly<Record<string, Forced>>>> = {
  "T12-0408": { ...paidOnTime([JUN, JUL, AUG], 5), [SEP]: UNPAID, [OCT]: { kind: "NO_BILL" } },
  "T21-1601": {
    ...paidOnTime([JUN, JUL, AUG, SEP], 5),
    [OCT]: { kind: "PART", dueOn: "2026-10-09", date: "2026-10-12", amountPaise: 500000n },
  },
  "T07-1203": paidOnTime(DEMO_PERIODS, 3),
  "T15-0902": { ...paidOnTime([JUN, JUL, AUG], 5), [SEP]: UNPAID, [OCT]: UNPAID },
  "T03-0702": { ...paidOnTime([JUN, JUL, AUG, SEP], 5), [OCT]: UNPAID },
  "T18-1105": { ...paidOnTime([JUN, JUL, AUG, SEP], 5), [OCT]: UNPAID },
  "T26-0301": { ...paidOnTime([JUN, JUL, AUG, SEP], 5), [OCT]: UNPAID },
};

function planFor(bill: DemoBill, forced: Forced | undefined, rng: Prng): Plan {
  if (forced?.kind === "UNPAID") return { kind: "UNPAID" };
  if (forced?.kind === "ON_TIME") return { kind: "FULL", date: addDays(bill.issuedOn, forced.day - 1), mode: "UPI" };
  if (forced?.kind === "PART") return { kind: "PART", date: forced.date, mode: "UPI", amountPaise: forced.amountPaise };

  const [onTime, late, partial, unpaid] = OUTCOME_WEIGHTS[bill.period];
  const outcome = rng.weighted<Outcome>([
    { value: "ON_TIME", weight: onTime },
    { value: "LATE", weight: late },
    { value: "PARTIAL", weight: partial },
    { value: "UNPAID", weight: unpaid },
  ]);
  if (outcome === "UNPAID") return { kind: "UNPAID" };

  const mode = rng.weighted(PAYMENT_MODES);
  if (outcome === "ON_TIME") return { kind: "FULL", date: addDays(bill.issuedOn, rng.weighted(ON_TIME_OFFSETS)), mode };
  if (outcome === "LATE") {
    const window = Math.min(LATE_PAYMENT_WINDOW_DAYS, diffDays(bill.dueOn, DEMO_AS_OF));
    return { kind: "FULL_LATE", date: addDays(bill.dueOn, rng.int(1, window)), mode };
  }
  // A part payment of 40% to 70% of the bill, to whole rupees, any time from issue until
  // 20 days after the due date or the demo date, whichever is earlier.
  const percent = BigInt(rng.int(40, 70));
  const amountPaise = ((2n * bill.amountPaise * percent + 10_000n) / 20_000n) * 100n;
  const latest = addDays(bill.dueOn, PARTIAL_PAYMENT_WINDOW_DAYS);
  const end = latest < DEMO_AS_OF ? latest : DEMO_AS_OF;
  return { kind: "PART", date: addDays(bill.issuedOn, rng.int(0, diffDays(bill.issuedOn, end))), mode, amountPaise };
}

/**
 * Posting rules (decisions D13, D26, D35). Every bill gets a BILL charge. A bill paid
 * late is settled with a LATE_FEE charge, computed as of the payment date, and one
 * PAYMENT of bill plus fee. A part payment is one PAYMENT with no fee posted: the fee
 * on an open bill is computed on demand, never stored.
 */
function entriesFor(flat: DemoFlat, bill: DemoBill, plan: Plan): DemoLedgerEntry[] {
  const suffix = `${flat.code}:${bill.period}`;
  const entry = (
    kind: "bill" | "latefee" | "payment",
    fields: Pick<DemoLedgerEntry, "entryType" | "direction" | "amountPaise" | "effectiveDate" | "reference">,
  ): DemoLedgerEntry => ({
    key: kind === "bill" ? `bill:${suffix}` : `${kind}:${suffix}`,
    flatKey: flat.key,
    billKey: bill.key,
    idempotencyKey: `seed:${kind}:${suffix}`,
    note: null,
    ...fields,
  });

  const entries = [
    entry("bill", { entryType: "BILL", direction: "CHARGE", amountPaise: bill.amountPaise, effectiveDate: bill.issuedOn, reference: null }),
  ];
  if (plan.kind === "UNPAID") return entries;

  const reference = `SEED-${plan.mode}-${flat.code}-${bill.period}`;
  const payment = (amountPaise: Paise) =>
    entry("payment", { entryType: "PAYMENT", direction: "PAYMENT", amountPaise, effectiveDate: plan.date, reference });

  if (plan.kind === "FULL") return [...entries, payment(bill.amountPaise)];
  if (plan.kind === "PART") return [...entries, payment(plan.amountPaise)];

  const { feePaise } = computeLateFee({
    billAmountPaise: bill.amountPaise,
    dueOn: bill.dueOn,
    asOf: plan.date,
    payments: [],
    holds: [],
    policy: defaultLateFeePolicy,
  });
  if (feePaise > 0n) {
    entries.push(entry("latefee", { entryType: "LATE_FEE", direction: "CHARGE", amountPaise: feePaise, effectiveDate: plan.date, reference: null }));
  }
  return [...entries, payment(bill.amountPaise + feePaise)];
}

export function buildBilling(flats: readonly DemoFlat[], rng: Prng): { bills: DemoBill[]; ledgerEntries: DemoLedgerEntry[] } {
  const bills: DemoBill[] = [];
  const ledgerEntries: DemoLedgerEntry[] = [];
  for (const flat of flats) {
    for (const period of DEMO_PERIODS) {
      const forced = FORCED[flat.code]?.[period];
      if (forced?.kind === "NO_BILL") continue;
      const bill: DemoBill = {
        key: `bill:${flat.code}:${period}`,
        flatKey: flat.key,
        period,
        issuedOn: period,
        dueOn: forced?.kind === "PART" ? forced.dueOn : addDays(period, DUE_DAY_OFFSET),
        amountPaise: BigInt(flat.areaSqft * RATE_PAISE_PER_SQFT),
        areaSqftSnapshot: flat.areaSqft,
        ratePaisePerSqft: RATE_PAISE_PER_SQFT,
      };
      bills.push(bill);
      ledgerEntries.push(...entriesFor(flat, bill, planFor(bill, forced, rng.fork(`bill:${flat.code}:${period}`))));
    }
  }
  return { bills, ledgerEntries };
}
