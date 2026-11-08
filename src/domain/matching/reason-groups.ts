import { REASON_CODES, type ReasonCode } from "./types";

/** The four groups of the Reason filter of the reconciliation workspace (D192), in the order the filter lists them. */
export const REASON_GROUPS = ["noflat", "several", "differs", "low"] as const;
export type ReasonGroup = (typeof REASON_GROUPS)[number];

/**
 * Which groups each stored reason code belongs to: zero, one or several. EVERY code of the matcher has an entry (the type makes a missing one a compile error and a
 * test checks the table at run time), so a code added later cannot be dropped without anyone deciding. The meaning of the groups:
 *   noflat   no flat could be found (nothing in the narration, or no narration)
 *   several  more than one flat is possible (an ambiguous or conflicting flat reference, a shared UPI id, several flats owing the amount)
 *   differs  the amount is not what the flat owes (less, more, only the principal, no open bill, or a note that disagrees with the amount)
 *   low      the evidence is weak or needs a second look (a name that matches only in part, no second signal, a later payment, a changed bill)
 */
export const GROUPS_OF_CODE: Readonly<Record<ReasonCode, readonly ReasonGroup[]>> = {
  CODE_FOUND: [],
  CODE_AMBIGUOUS: ["several"],
  CODE_CONFLICT: ["several"],
  PAYER_KNOWN: [],
  PAYER_SHARED: ["several"],
  NAME_EXACT: [],
  NAME_INITIAL: ["low"],
  NAME_TRUNCATED: ["low"],
  AMOUNT_EQUALS_DUE: [],
  AMOUNT_PRINCIPAL_ONLY: ["differs"],
  AMOUNT_LESS: ["differs"],
  AMOUNT_MORE: ["differs"],
  NO_OPEN_BILL: ["differs"],
  MULTIPLE_FLATS_OWE: ["several"],
  ABOVE_THRESHOLD: [],
  HINT_CONFLICT: ["differs"],
  LATER_PAYMENT: ["low"],
  NEEDS_SECOND_SIGNAL: ["low"],
  STATE_CHANGED: ["low"],
  DEBIT: [],
  INTEREST: [],
  BANK_CHARGE: [],
  CHEQUE_RETURN: [],
  NO_NARRATION: ["noflat"],
  NO_MATCH: ["noflat"],
};

/**
 * The groups a row belongs to, from its stored reason codes and its stored confidence: the union of the groups of its codes, plus "low" when the matcher's own
 * confidence for the row is LOW (the word the row card shows). A code this table does not know is not guessed at: it adds no group.
 */
export function reasonGroups(codes: readonly string[], confidence: string | null = null): ReasonGroup[] {
  const found = new Set<ReasonGroup>();
  for (const code of codes) {
    if (Object.prototype.hasOwnProperty.call(GROUPS_OF_CODE, code)) for (const group of GROUPS_OF_CODE[code as ReasonCode]) found.add(group);
  }
  if (confidence === "LOW") found.add("low");
  return REASON_GROUPS.filter((group) => found.has(group));
}

/** Every reason code that puts a row in `group`, for the SQL that does the same filtering in the database. */
export const codesOfGroup = (group: ReasonGroup): ReasonCode[] => REASON_CODES.filter((code) => GROUPS_OF_CODE[code].includes(group));
