import type { Paise } from "../../money/money";
import type { Prng } from "../../seed/prng";
import type { DemoDataset } from "../../seed/types";
import type { FlatContext, KnownPayer, OpenBill, PaymentOnBill } from "../types";

/**
 * The demo dataset as the matcher's input. A resident is a member whose membership has not ended by
 * `asOf`. A bill is open when the payments dated on or before `asOf` leave some of its amount unpaid.
 * Known payers are the ones the dataset has.
 */
export function flatContextsFromDataset(dataset: DemoDataset, asOf: string = dataset.asOf): FlatContext[] {
  const userName = new Map(dataset.users.map((u) => [u.key, u.name]));
  const paymentsByBill = new Map<string, PaymentOnBill[]>();
  for (const entry of dataset.ledgerEntries) {
    if (entry.entryType !== "PAYMENT" || entry.billKey === null) continue;
    const list = paymentsByBill.get(entry.billKey) ?? [];
    list.push({ date: entry.effectiveDate, amountPaise: entry.amountPaise });
    paymentsByBill.set(entry.billKey, list);
  }
  const billsByFlat = new Map<string, OpenBill[]>();
  for (const b of dataset.bills) {
    const payments = paymentsByBill.get(b.key) ?? [];
    const paid = payments.reduce((sum, p) => (p.date <= asOf ? sum + p.amountPaise : sum), 0n);
    if (b.issuedOn > asOf || paid >= b.amountPaise) continue;
    const list = billsByFlat.get(b.flatKey) ?? [];
    list.push({ billKey: b.key, amountPaise: b.amountPaise, dueOn: b.dueOn, paymentsOnBill: payments });
    billsByFlat.set(b.flatKey, list);
  }
  const residentsByFlat = new Map<string, { name: string }[]>();
  for (const m of dataset.members) {
    if (m.endsOn !== null && m.endsOn < asOf) continue;
    const list = residentsByFlat.get(m.flatKey) ?? [];
    list.push({ name: userName.get(m.userKey) as string });
    residentsByFlat.set(m.flatKey, list);
  }
  const payersByFlat = new Map<string, KnownPayer[]>();
  for (const p of dataset.knownPayers) {
    const list = payersByFlat.get(p.flatKey) ?? [];
    list.push({ type: p.identifierType, value: p.identifierValue });
    payersByFlat.set(p.flatKey, list);
  }
  return dataset.flats.map((f) => ({
    code: f.code,
    residents: residentsByFlat.get(f.key) ?? [],
    knownPayers: payersByFlat.get(f.key) ?? [],
    openBills: billsByFlat.get(f.key) ?? [],
  }));
}

/** What a simulated society starts from: the demo flats as of the dataset's date, and each flat's usual bill. */
export type Base = {
  flats: FlatContext[];
  /** The amount of the flat's bills, from the dataset, also for flats that have no open bill. */
  billAmountByFlat: ReadonlyMap<string, Paise>;
};

export function prepareBase(dataset: DemoDataset): Base {
  const flatCode = new Map(dataset.flats.map((f) => [f.key, f.code]));
  const billAmountByFlat = new Map<string, Paise>();
  for (const bill of dataset.bills) billAmountByFlat.set(flatCode.get(bill.flatKey) as string, bill.amountPaise);
  return { flats: flatContextsFromDataset(dataset), billAmountByFlat };
}

/** A resident who can pay: the name on the account, the flat they live in and their UPI address. */
export type Person = { name: string; flatCode: string; upi: string };

export type Population = {
  /** The flats with the simulator's own registered payers in place of the dataset's. */
  flats: FlatContext[];
  people: Person[];
  billAmountByFlat: ReadonlyMap<string, Paise>;
};

/** The share of residents whose UPI address is registered with their flat. */
export const REGISTERED_SHARE = 0.3;
/** The share of registered addresses that are registered with a second flat as well. */
export const SHARED_SHARE = 0.02;

const HANDLES = ["oksbi", "okhdfcbank", "ybl", "paytm", "okaxis", "ibl"];

/** `aamir.s`, `aamirshaikh` or `aamir42`, then a handle. Two people can end up with the same address. */
function upiAddress(rng: Prng, name: string): string {
  const [first, last = "x"] = name.toLowerCase().split(/\s+/);
  const local = rng.weighted([
    { value: `${first}.${last[0]}`, weight: 5 },
    { value: `${first}${last}`, weight: 3 },
    { value: `${first}${rng.int(1, 99)}`, weight: 2 },
  ]);
  return `${local}@${rng.pick(HANDLES)}`;
}

/**
 * Decides who pays from where: every resident gets a UPI address, 30% of them are registered with their
 * flat as a known payer, and 2% of the registered addresses are registered with a second flat too (a shared
 * address). The dataset's own known payers are dropped, so the population depends on the seed alone.
 */
export function buildPopulation(base: Base, rng: Prng): Population {
  const people: Person[] = [];
  const registered = new Map<string, Set<string>>();
  const register = (flatCode: string, upi: string): void => {
    const set = registered.get(flatCode) ?? new Set<string>();
    set.add(upi);
    registered.set(flatCode, set);
  };
  for (const flat of base.flats) {
    for (const resident of flat.residents) {
      const person: Person = { name: resident.name, flatCode: flat.code, upi: upiAddress(rng, resident.name) };
      people.push(person);
      if (!rng.chance(REGISTERED_SHARE)) continue;
      register(flat.code, person.upi);
      if (rng.chance(SHARED_SHARE)) register(rng.pick(base.flats).code, person.upi);
    }
  }
  const flats = base.flats.map((f): FlatContext => ({ ...f, knownPayers: [...(registered.get(f.code) ?? [])].map((value): KnownPayer => ({ type: "UPI_ID", value })) }));
  return { flats, people, billAmountByFlat: base.billAmountByFlat };
}
