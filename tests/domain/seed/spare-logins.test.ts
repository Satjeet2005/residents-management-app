import { describe, expect, it } from "vitest";
import { SPARE_LOGINS } from "../../integration/spare-logins-data";
import { defaultDataset } from "./default-dataset";
import { SAMPLE_STATEMENT_LINES } from "@/server/statements/sample-statement";

/**
 * D233: eight existing demo logins are the spare logins for paying a bill, so reviewers can pay without using up the three sample flats. No row is added
 * to the seed. Each login is the ONLY resident of its flat; the flat has exactly one open bill (October 2026, unpaid), no complaint, and its code is
 * not written anywhere in the sample bank statement. deployment.md lists the same phones.
 */
const SAMPLE_FLATS = ["T07-1203", "T12-0408", "T21-1601"];
const dataset = defaultDataset();
const flatOf = (code: string) => dataset.flats.find((f) => f.code === code);
const userOf = (phone: string) => dataset.users.find((u) => u.phone === phone);

describe("D233 the eight spare demo logins", () => {
  it("are eight different phones in eight different flats, none of them a sample flat or a staff login", () => {
    expect(new Set(SPARE_LOGINS.map((s) => s.phone)).size).toBe(8);
    expect(new Set(SPARE_LOGINS.map((s) => s.flatCode)).size).toBe(8);
    for (const spare of SPARE_LOGINS) {
      expect(SAMPLE_FLATS).not.toContain(spare.flatCode);
      expect(userOf(spare.phone)?.role, spare.phone).toBe("RESIDENT");
    }
  });

  it.each(SPARE_LOGINS)("$phone is the only resident of $flatCode, with no end date", ({ phone, flatCode }) => {
    const flat = flatOf(flatCode);
    const user = userOf(phone);
    expect(flat).toBeDefined();
    expect(user).toBeDefined();
    const members = dataset.members.filter((m) => m.flatKey === flat?.key);
    expect(members.map((m) => m.userKey)).toEqual([user?.key]);
    expect(members[0].endsOn).toBeNull();
  });

  it.each(SPARE_LOGINS)("$flatCode has exactly one open bill, October 2026, of ₹$dueRupees, with no payment on it", ({ flatCode, dueRupees }) => {
    const flat = flatOf(flatCode);
    const bills = dataset.bills.filter((b) => b.flatKey === flat?.key);
    const paid = new Set(dataset.ledgerEntries.filter((e) => e.flatKey === flat?.key && e.entryType === "PAYMENT" && e.billKey !== null).map((e) => e.billKey));
    const open = bills.filter((b) => !paid.has(b.key));
    expect(open.map((b) => b.period)).toEqual(["2026-10-01"]);
    expect(open[0].amountPaise).toBe(BigInt(dueRupees) * 100n);
  });

  it.each(SPARE_LOGINS)("$flatCode has no complaint, and its code is not in the sample bank statement", ({ flatCode }) => {
    const flat = flatOf(flatCode);
    expect(dataset.complaints.filter((c) => c.flatKey === flat?.key)).toEqual([]);
    const [tower, unit] = flatCode.slice(1).split("-");
    const statement = SAMPLE_STATEMENT_LINES.join("\n").toUpperCase().replace(/\s+/g, " ");
    expect(new RegExp(`T${tower}[-/ ]?${unit}`).test(statement)).toBe(false);
  });

  it("the phones 5000000011 to 5000000018 belong to generated residents already, so the seed was not changed to add logins", () => {
    for (let n = 11; n <= 18; n += 1) expect(userOf(`50000000${String(n).padStart(2, "0")}`)?.role).toBe("RESIDENT");
    expect(dataset.users).toHaveLength(3434);
  });
});
