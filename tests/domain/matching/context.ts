import { buildMatchContext, defaultMatchSettings } from "@/domain/matching/context";
import type { FlatContext, MatchContext, MatchSettings, OpenBill } from "@/domain/matching/types";
import { generateDemoDataset } from "@/domain/seed/generate";
import type { DemoDataset } from "@/domain/seed/types";

/**
 * The test adapter: the demo dataset as the matcher's input. A resident is a member whose
 * membership has not ended by `asOf`. A bill is open when the payments dated on or before
 * `asOf` leave some of its amount unpaid.
 */
export function flatContextsFromDataset(dataset: DemoDataset, asOf: string = dataset.asOf): FlatContext[] {
  const userName = new Map(dataset.users.map((u) => [u.key, u.name]));
  const paymentsByBill = new Map<string, { date: string; amountPaise: bigint }[]>();
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
  const payersByFlat = new Map<string, FlatContext["knownPayers"][number][]>();
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

export function demoMatchContext(dataset: DemoDataset, settings: MatchSettings = defaultMatchSettings): MatchContext {
  return buildMatchContext(flatContextsFromDataset(dataset), settings);
}

let cached: DemoDataset | undefined;
/** The default-seed demo dataset, generated once per test file. */
export function demoDataset(): DemoDataset {
  cached ??= generateDemoDataset();
  return cached;
}
