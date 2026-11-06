import { createHash } from "node:crypto";
import type { DbOrTx } from "@/server/auth/db";

/** What a bank row says about its own bank reference: the rail the narration reader found, and the reference it read (or null). */
export type BankReferenceSource = { rail: string; reference: string | null; dedupeKey: string };

/** A reference the bank gave: a UPI reference, a UTR, an IMPS reference or a cheque number. Letters and digits only, so no narration text can pass. */
const CLEAR_REFERENCE = /^[A-Za-z0-9]{4,40}$/;

/** `bank:h:<first 32 hex of SHA-256 of the dedupe key>`: for a row with no bank reference, or one that is not unique. No narration text. */
export function hashedBankReference(dedupeKey: string): string {
  return `bank:h:${createHash("sha256").update(dedupeKey, "utf8").digest("hex").slice(0, 32)}`;
}

/** `bank:<rail>:<reference>` in clear when the row has a bank reference (D106), otherwise the hashed form. */
export function bankReference(source: BankReferenceSource): string {
  const reference = source.reference;
  if (reference === null || !CLEAR_REFERENCE.test(reference)) return hashedBankReference(source.dedupeKey);
  const rail = source.rail.toLowerCase().replace(/[^a-z]/g, "");
  return rail === "" ? hashedBankReference(source.dedupeKey) : `bank:${rail}:${reference}`;
}

/**
 * The ledger reference of each item (D106). The ledger keeps a reference unique, and a bank can repeat a reference on two different
 * rows, so a reference that another entry already holds, or that two items of this call share, falls back to the hashed form: a
 * clash must never stop an import or a posting. Reads only; call it inside the transaction that writes.
 */
export async function bankReferences<K>(db: DbOrTx, items: readonly { key: K; source: BankReferenceSource }[]): Promise<Map<K, string>> {
  const wanted = items.map((item) => ({ key: item.key, source: item.source, ref: bankReference(item.source) }));
  const clear = wanted.filter((w) => !w.ref.startsWith("bank:h:")).map((w) => w.ref);
  const taken = new Set<string>();
  for (let i = 0; i < clear.length; i += 1000) {
    for (const found of await db.ledgerEntry.findMany({ where: { reference: { in: clear.slice(i, i + 1000) } }, select: { reference: true } })) taken.add(found.reference as string);
  }
  const counts = new Map<string, number>();
  for (const w of wanted) counts.set(w.ref, (counts.get(w.ref) ?? 0) + 1);
  return new Map(wanted.map((w) => [w.key, taken.has(w.ref) || (counts.get(w.ref) ?? 0) > 1 ? hashedBankReference(w.source.dedupeKey) : w.ref]));
}
