import { defaultLateFeePolicy, validateLateFeePolicy } from "../billing/late-fee";
import { isValidDate } from "../time/calendar";
import { nameLookupKey, nameWords } from "./names";
import type { FlatContext, MatchContext, MatchSettings } from "./types";

export const defaultMatchSettings: MatchSettings = {
  approvalThresholdPaise: 2_500_000n,
  lateFeePolicy: defaultLateFeePolicy,
};

/** A UPI id made comparable: trimmed and lower case. */
export const normaliseUpiId = (value: string): string => value.trim().toLowerCase();

function checkSettings(settings: MatchSettings): void {
  if (settings.approvalThresholdPaise <= 0n) throw new RangeError("approvalThresholdPaise must be positive");
  validateLateFeePolicy(settings.lateFeePolicy);
}

/** Returns the flat with its open bills checked and in order, oldest due date first (then bill key). */
function checkedFlat(flat: FlatContext): FlatContext {
  const seen = new Set<string>();
  for (const bill of flat.openBills) {
    if (bill.amountPaise <= 0n) throw new RangeError(`Flat ${flat.code}: bill ${bill.billKey} must have a positive amount`);
    if (!isValidDate(bill.dueOn)) throw new RangeError(`Flat ${flat.code}: bill ${bill.billKey} has an invalid due date "${bill.dueOn}"`);
    if (seen.has(bill.billKey)) throw new RangeError(`Flat ${flat.code}: bill key ${bill.billKey} is listed twice`);
    seen.add(bill.billKey);
    for (const payment of bill.paymentsOnBill) {
      if (!isValidDate(payment.date) || payment.amountPaise <= 0n) {
        throw new RangeError(`Flat ${flat.code}: bill ${bill.billKey} has an invalid payment`);
      }
    }
  }
  const openBills = [...flat.openBills].sort((a, b) => (a.dueOn === b.dueOn ? (a.billKey < b.billKey ? -1 : a.billKey > b.billKey ? 1 : 0) : a.dueOn < b.dueOn ? -1 : 1));
  return { ...flat, openBills };
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

/**
 * Builds the indexes the matcher reads, once: flats by code, by UPI id and by name word,
 * plus empty caches that fill as rows are matched. Throws RangeError for a repeated flat code,
 * a bad bill or a bad setting. The input is not changed.
 */
export function buildMatchContext(flats: readonly FlatContext[], settings: MatchSettings = defaultMatchSettings): MatchContext {
  checkSettings(settings);
  const checked = flats.map(checkedFlat);
  const flatsByCode = new Map<string, FlatContext>();
  const flatsByUpiId = new Map<string, FlatContext[]>();
  const flatsByNameKey = new Map<string, FlatContext[]>();
  const nameKeysByFlat = new Map<string, Set<string>>();

  for (const flat of checked) {
    if (flatsByCode.has(flat.code)) throw new RangeError(`Flat code ${flat.code} is listed twice`);
    flatsByCode.set(flat.code, flat);
    const names = [...flat.residents.map((r) => r.name), ...flat.knownPayers.filter((p) => p.type === "NAME").map((p) => p.value)];
    const keys = new Set<string>();
    for (const word of names.flatMap(nameWords)) {
      if (word.length < 2) continue;
      keys.add(nameLookupKey(word));
      addTo(flatsByNameKey, nameLookupKey(word), flat);
    }
    nameKeysByFlat.set(flat.code, keys);
    for (const payer of flat.knownPayers) {
      if (payer.type === "UPI_ID" && normaliseUpiId(payer.value) !== "") addTo(flatsByUpiId, normaliseUpiId(payer.value), flat);
    }
  }
  return {
    settings,
    flats: checked,
    flatsByCode,
    flatsByUpiId,
    flatsByNameKey,
    nameKeysByFlat,
    caches: { fees: new Map(), amounts: new Map() },
  };
}
