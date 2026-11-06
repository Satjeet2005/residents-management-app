import { generateDemoDataset } from "@/domain/seed/generate";
import { buildSettings } from "@/domain/seed/settings";
import { DEMO_NOW, type DemoDataset } from "@/domain/seed/types";
import { assembleHome, type BillRow, type ComplaintRow, type EntryRow, type HomeInput } from "@/server/home/mapper";
import type { HomeData } from "@/server/home/types";

/** Home data for the seeded flats, built from the seed dataset the way the queries would return it. Shared by the Home tests. */
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
export const SETTINGS = buildSettings().map((s) => ({ key: s.key, value: s.value }));

let cached: DemoDataset | undefined;
export function dataset(): DemoDataset {
  cached ??= generateDemoDataset();
  return cached;
}

/** The rows the queries would return for one flat, with the member the seed gave it. */
export function inputFor(flatCode: string, now = DEMO_NOW): HomeInput {
  const data = dataset();
  const flat = data.flats.find((f) => f.code === flatCode);
  if (flat === undefined) throw new Error(`no flat ${flatCode}`);
  const member = data.members.find((m) => m.flatKey === flat.key);
  const user = data.users.find((u) => u.key === member?.userKey);
  if (member === undefined || user === undefined) throw new Error("no member");
  const bills: BillRow[] = data.bills.filter((b) => b.flatKey === flat.key).map((b) => ({ id: b.key, period: day(b.period), issuedOn: day(b.issuedOn), dueOn: day(b.dueOn), amountPaise: b.amountPaise }));
  const entries: EntryRow[] = data.ledgerEntries
    .filter((e) => e.flatKey === flat.key)
    .map((e, i) => ({ id: e.key, entryType: e.entryType, direction: e.direction, amountPaise: e.amountPaise, effectiveDate: day(e.effectiveDate), billId: e.billKey, reversesEntryId: null, createdAt: new Date(1_700_000_000_000 + i) }));
  const complaints: ComplaintRow[] = data.complaints
    .filter((c) => c.flatKey === flat.key)
    .map((c) => ({ body: c.body, status: c.status, createdAt: new Date(c.createdAt), responseDueAt: new Date(c.responseDueAt), firstResponseAt: c.firstResponseAt === null ? null : new Date(c.firstResponseAt) }));
  const visitors = data.visitorPasses
    .filter((v) => v.flatKey === flat.key && v.status !== "CANCELLED" && v.expectedAt >= DEMO_NOW - 12 * 3_600_000 && v.expectedAt < DEMO_NOW + 12 * 3_600_000)
    .map((v) => ({ expectedAt: new Date(v.expectedAt) }));
  return { userName: user.name, now, memberships: [{ flatId: flat.key, flatCode: flat.code, relation: member.relation }], bills, entries, complaints, visitors, settings: SETTINGS, latestAttempt: null };
}

export const home = (flatCode: string, now = DEMO_NOW): Extract<HomeData, { kind: "OK" }> => {
  const out = assembleHome(inputFor(flatCode, now));
  if (out.kind !== "OK") throw new Error("expected OK");
  return out;
};
