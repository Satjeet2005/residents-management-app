import { describe, expect, it } from "vitest";
import { bankReference, bankReferences, hashedBankReference } from "@/server/statements/reference";
import type { DbOrTx } from "@/server/auth/db";

const KEY = "2026-10-27|646800|upi|aamir shaikh t21-1601 maintenance";

describe("D106 ledger references of a bank posting", () => {
  it.each<[string, string, string | null, string]>([
    ["a UPI reference", "UPI", "402200118877", "bank:upi:402200118877"],
    ["a UTR", "NEFT", "N710000000007", "bank:neft:N710000000007"],
    ["an IMPS reference", "IMPS", "639342200022", "bank:imps:639342200022"],
    ["a cheque number", "CHEQUE_DEPOSIT", "482913", "bank:chequedeposit:482913"],
  ])("%s stays in clear", (_label, rail, reference, expected) => {
    expect(bankReference({ rail, reference, dedupeKey: KEY })).toBe(expected);
  });

  it("a row with no bank reference gets the first 32 hex of the SHA-256 of its dedupe key, and no narration text", () => {
    const ref = bankReference({ rail: "CASH_DEPOSIT", reference: null, dedupeKey: KEY });
    expect(ref).toMatch(/^bank:h:[0-9a-f]{32}$/);
    expect(ref).toBe(hashedBankReference(KEY));
    expect(ref).not.toMatch(/aamir|shaikh|maintenance/i);
  });

  it("a reference that is not letters and digits (so could carry narration text) is hashed instead", () => {
    expect(bankReference({ rail: "UPI", reference: "T21-1601 Aamir", dedupeKey: KEY })).toMatch(/^bank:h:/);
    expect(bankReference({ rail: "UPI", reference: "12", dedupeKey: KEY })).toMatch(/^bank:h:/);
  });

  it("two different dedupe keys give two different hashed references", () => {
    expect(hashedBankReference(KEY)).not.toBe(hashedBankReference(`${KEY}x`));
  });

  const fakeDb = (taken: string[]): DbOrTx => ({ ledgerEntry: { findMany: async ({ where }: { where: { reference: { in: string[] } } }) => where.reference.in.filter((r) => taken.includes(r)).map((reference) => ({ reference })) } }) as unknown as DbOrTx;

  it("a clear reference that another entry already holds, or that two rows share, falls back to the hashed form", async () => {
    const items = [
      { key: 1, source: { rail: "UPI", reference: "402200118877", dedupeKey: "a" } },
      { key: 2, source: { rail: "UPI", reference: "402200118878", dedupeKey: "b" } },
      { key: 3, source: { rail: "UPI", reference: "402200118879", dedupeKey: "c" } },
      { key: 4, source: { rail: "UPI", reference: "402200118879", dedupeKey: "d" } },
    ];
    const map = await bankReferences(fakeDb(["bank:upi:402200118878"]), items);
    expect(map.get(1)).toBe("bank:upi:402200118877");
    expect(map.get(2)).toBe(hashedBankReference("b"));
    expect(map.get(3)).toBe(hashedBankReference("c"));
    expect(map.get(4)).toBe(hashedBankReference("d"));
  });
});
