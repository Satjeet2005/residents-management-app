import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIRST_NAMES, LAST_NAMES } from "@/domain/seed/names";
import { generateDemoDataset } from "@/domain/seed/generate";
import { defaultDataset } from "./default-dataset";

const dataset = defaultDataset();
const flatByCode = (code: string) => {
  const flat = dataset.flats.find((f) => f.code === code);
  if (flat === undefined) throw new Error(`flat ${code} is missing`);
  return flat;
};
const membersOf = (code: string) =>
  dataset.members
    .filter((m) => m.flatKey === flatByCode(code).key)
    .map((m) => ({ ...m, user: dataset.users.find((u) => u.key === m.userKey)! }));

describe("S2 structure", () => {
  it("S2 has 2,400 flats in 28 towers: 20 towers of 86 and 8 of 85", () => {
    expect(dataset.flats).toHaveLength(2400);
    const perTower = new Map<string, number>();
    for (const flat of dataset.flats) perTower.set(flat.tower, (perTower.get(flat.tower) ?? 0) + 1);
    expect(perTower.size).toBe(28);
    const sizes = [...perTower.values()];
    expect(sizes.filter((n) => n === 86)).toHaveLength(20);
    expect(sizes.filter((n) => n === 85)).toHaveLength(8);
  });

  it("S2 codes are unique and match T{01-28}-{floor 01-16}{unit 01-08}", () => {
    const codes = dataset.flats.map((f) => f.code);
    expect(new Set(codes).size).toBe(2400);
    for (const code of codes) expect(code).toMatch(/^T(0[1-9]|1\d|2[0-8])-(0[1-9]|1[0-6])(0[1-8])$/);
    for (const flat of dataset.flats) {
      expect(flat.key).toBe(`flat:${flat.code}`);
      expect(flat.code).toBe(`${flat.tower}-${flat.number}`);
    }
  });

  it("S2 mean area is within 1,145 to 1,165 sq ft and every area is an integer in [450, 2400]", () => {
    const mean = dataset.flats.reduce((sum, f) => sum + f.areaSqft, 0) / dataset.flats.length;
    expect(mean).toBeGreaterThanOrEqual(1145);
    expect(mean).toBeLessThanOrEqual(1165);
    for (const flat of dataset.flats) {
      expect(Number.isInteger(flat.areaSqft)).toBe(true);
      expect(flat.areaSqft).toBeGreaterThanOrEqual(450);
      expect(flat.areaSqft).toBeLessThanOrEqual(2400);
    }
  });

  it("S2 every bill is area x 650 paise, issued on the 1st and due on the 10th (one exception)", () => {
    const flats = new Map(dataset.flats.map((f) => [f.key, f]));
    for (const bill of dataset.bills) {
      const flat = flats.get(bill.flatKey)!;
      expect(bill.amountPaise).toBe(BigInt(flat.areaSqft) * 650n);
      expect(bill.areaSqftSnapshot).toBe(flat.areaSqft);
      expect(bill.ratePaisePerSqft).toBe(650);
      expect(bill.issuedOn).toBe(bill.period);
      expect(bill.period.endsWith("-01")).toBe(true);
      if (bill.key !== "bill:T21-1601:2026-10-01") expect(bill.dueOn).toBe(`${bill.period.slice(0, 8)}10`);
    }
    expect(dataset.bills).toHaveLength(2400 * 5 - 1);
  });

  it("S2 keys are unique and every reference points at an existing row", () => {
    const flatKeys = new Set(dataset.flats.map((f) => f.key));
    const userKeys = new Set(dataset.users.map((u) => u.key));
    const billKeys = new Set(dataset.bills.map((b) => b.key));
    expect(flatKeys.size).toBe(dataset.flats.length);
    expect(userKeys.size).toBe(dataset.users.length);
    expect(billKeys.size).toBe(dataset.bills.length);
    expect(new Set(dataset.ledgerEntries.map((e) => e.key)).size).toBe(dataset.ledgerEntries.length);
    for (const m of dataset.members) {
      expect(flatKeys.has(m.flatKey)).toBe(true);
      expect(userKeys.has(m.userKey)).toBe(true);
    }
    for (const b of dataset.bills) expect(flatKeys.has(b.flatKey)).toBe(true);
    for (const e of dataset.ledgerEntries) {
      expect(flatKeys.has(e.flatKey)).toBe(true);
      expect(e.billKey === null || billKeys.has(e.billKey)).toBe(true);
    }
    for (const s of dataset.staff) expect(userKeys.has(s.userKey)).toBe(true);
  });
});

describe("S3 forced flats", () => {
  it("S3 areas: T07-1203 = 1150, T12-0408 = 980, T21-1601 = 1640, T15-0902 = 1320, and 1640 for the three cheque flats", () => {
    expect(flatByCode("T07-1203").areaSqft).toBe(1150);
    expect(flatByCode("T12-0408").areaSqft).toBe(980);
    expect(flatByCode("T21-1601").areaSqft).toBe(1640);
    expect(flatByCode("T15-0902").areaSqft).toBe(1320);
    for (const code of ["T03-0702", "T18-1105", "T26-0301"]) expect(flatByCode(code).areaSqft).toBe(1640);
  });

  it("S3 residents: owners and tenant with the right relations", () => {
    expect(membersOf("T07-1203").map((m) => [m.user.name, m.relation])).toEqual([["Neeraj Kulkarni", "OWNER"]]);
    expect(membersOf("T12-0408").map((m) => [m.user.name, m.relation])).toEqual([
      ["Swati Joshi", "TENANT"],
      ["Anil Joshi", "OWNER"],
    ]);
    expect(membersOf("T21-1601").map((m) => [m.user.name, m.relation])).toEqual([["Aamir Shaikh", "OWNER"]]);
    expect(membersOf("T15-0902").map((m) => [m.user.name, m.relation])).toEqual([["Rohit Deshmukh", "OWNER"]]);
  });

  it("S3 bill amounts: 637000, 1066000 and 747500 for the sample flats", () => {
    const amountsOf = (code: string) => new Set(dataset.bills.filter((b) => b.flatKey === `flat:${code}`).map((b) => b.amountPaise));
    expect(amountsOf("T12-0408")).toEqual(new Set([637000n]));
    expect(amountsOf("T21-1601")).toEqual(new Set([1066000n]));
    expect(amountsOf("T07-1203")).toEqual(new Set([747500n]));
  });

  it("S3 T12-0408 has no October bill; T21-1601's October bill is due 2026-10-09", () => {
    const periodsOf = (code: string) => dataset.bills.filter((b) => b.flatKey === `flat:${code}`).map((b) => b.period);
    expect(periodsOf("T12-0408")).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    const october = dataset.bills.find((b) => b.key === "bill:T21-1601:2026-10-01")!;
    expect(october.issuedOn).toBe("2026-10-01");
    expect(october.dueOn).toBe("2026-10-09");
  });
});

describe("S7 people", () => {
  it("S7 every phone is 10 digits, starts with 5 and is unique", () => {
    for (const user of dataset.users) expect(user.phone).toMatch(/^5\d{9}$/);
    expect(new Set(dataset.users.map((u) => u.phone)).size).toBe(dataset.users.length);
    expect(dataset.users[0].phone).toBe("5000000001");
  });

  it("S7 every flat has at least one member, and each user belongs to at most one flat", () => {
    const membersPerFlat = new Map<string, number>();
    for (const m of dataset.members) membersPerFlat.set(m.flatKey, (membersPerFlat.get(m.flatKey) ?? 0) + 1);
    for (const flat of dataset.flats) {
      const count = membersPerFlat.get(flat.key) ?? 0;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
    expect(new Set(dataset.members.map((m) => m.userKey)).size).toBe(dataset.members.length);
  });

  it("S7 about 18% of flats are tenanted (14% to 22%)", () => {
    const tenanted = new Set(dataset.members.filter((m) => m.relation === "TENANT").map((m) => m.flatKey)).size;
    expect(tenanted / dataset.flats.length).toBeGreaterThanOrEqual(0.14);
    expect(tenanted / dataset.flats.length).toBeLessThanOrEqual(0.22);
  });

  it("S7 staff have the listed permissions, are STAFF users and belong to no flat", () => {
    const permissionsOf = (name: string) => {
      const user = dataset.users.find((u) => u.name === name)!;
      expect(user.role).toBe("STAFF");
      expect(dataset.members.some((m) => m.userKey === user.key)).toBe(false);
      return dataset.staff.find((s) => s.userKey === user.key)!.permissions;
    };
    expect(permissionsOf("Priya Nair")).toEqual(["payments:match"]);
    expect(permissionsOf("Rahul Menon")).toEqual(["payments:match", "payments:approve"]);
    expect(permissionsOf("Meera Kapoor")).toEqual(["reports:view"]);
    expect(permissionsOf("Kavita Rao")).toEqual(["complaints:manage"]);
    expect(permissionsOf("Sanjay Pawar")).toEqual(["complaints:manage", "complaints:duty_manager"]);
    expect(dataset.staff).toHaveLength(5);
    expect(dataset.users.filter((u) => u.role === "STAFF")).toHaveLength(5);
  });

  it("S7 residents are RESIDENT and active; names come from the lists and the sample names are not reused", () => {
    const sample = new Set(["Neeraj Kulkarni", "Swati Joshi", "Anil Joshi", "Aamir Shaikh", "Rohit Deshmukh"]);
    const staffNames = new Set(["Priya Nair", "Rahul Menon", "Meera Kapoor", "Kavita Rao", "Sanjay Pawar"]);
    const residents = dataset.users.filter((u) => u.role === "RESIDENT");
    expect(residents).toHaveLength(dataset.members.length);
    for (const user of residents) {
      expect(user.active).toBe(true);
      if (sample.has(user.name) || staffNames.has(user.name)) continue;
      const [first, last] = user.name.split(" ");
      expect(FIRST_NAMES).toContain(first);
      expect(LAST_NAMES).toContain(last);
    }
    for (const name of [...sample, ...staffNames]) expect(dataset.users.filter((u) => u.name === name)).toHaveLength(1);
  });

  it("S7 the name lists have 60+ first names and 40+ surnames, without repeats", () => {
    expect(FIRST_NAMES.length).toBeGreaterThanOrEqual(60);
    expect(LAST_NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
    expect(new Set(LAST_NAMES).size).toBe(LAST_NAMES.length);
  });

  it("S7 family members share the owner's surname", () => {
    const users = new Map(dataset.users.map((u) => [u.key, u]));
    for (const m of dataset.members.filter((x) => x.relation === "FAMILY")) {
      const owner = dataset.members.find((o) => o.flatKey === m.flatKey && o.relation === "OWNER")!;
      expect(users.get(m.userKey)!.name.split(" ")[1]).toBe(users.get(owner.userKey)!.name.split(" ")[1]);
    }
  });
});

describe("S8 purity and speed", () => {
  // Budget 4 s: slowest observed under 5x load was 1.05 s.
  it("S8 generates the whole dataset in under 4 seconds", () => {
    const started = performance.now();
    generateDemoDataset({ seed: 99 });
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it("S8 the generator files use no Math.random, Date.now, Intl or Node built-ins", () => {
    const dir = path.resolve(process.cwd(), "src/domain/seed");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/Math\.random|Date\.now|\bIntl\b|node:/);
    }
  });
});
