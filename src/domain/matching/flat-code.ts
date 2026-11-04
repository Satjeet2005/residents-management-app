/**
 * Flat codes look like T12-0408: tower 01 to 28, then the floor (01 to 16) and
 * the unit on that floor (01 to 08). This is a synthetic layout for the demo
 * society (see docs/bank-statements.md), not a fact about any real building.
 */
const MAX_TOWER = 28;
const MAX_FLOOR = 16;
const MAX_UNIT = 8;

export type FlatToken = {
  /** The canonical code, for example "T12-0408". */
  code: string;
  /** True when the text can be read as more than one valid code, so none of them is certain. */
  ambiguous: boolean;
  /** The part of the text that was read, for example "t12 408". */
  matchedText: string;
};

/** "T12-0408" from a tower (1 or 2 digits) and a number (3 or 4 digits, zero-padded), or null when a part is out of range. */
export function normalizeFlatCodeParts(tower: string | number, number: string | number): string | null {
  const towerText = String(tower).trim();
  const numberText = String(number).trim();
  if (!/^\d{1,2}$/.test(towerText) || !/^\d{3,4}$/.test(numberText)) return null;
  const padded = numberText.padStart(4, "0");
  const towerNumber = Number(towerText);
  const floor = Number(padded.slice(0, 2));
  const unit = Number(padded.slice(2));
  if (towerNumber < 1 || towerNumber > MAX_TOWER) return null;
  if (floor < 1 || floor > MAX_FLOOR) return null;
  if (unit < 1 || unit > MAX_UNIT) return null;
  return `T${String(towerNumber).padStart(2, "0")}-${padded}`;
}

/** True only for the canonical form, such as "T12-0408". */
export function isValidFlatCode(code: string): boolean {
  const match = /^T(\d{2})-(\d{4})$/.exec(code);
  return match !== null && normalizeFlatCodeParts(match[1], match[2]) === code;
}

/**
 * A flat reference starts with T or t (not inside a word or a longer number),
 * then up to six digits that may be split once by one separator.
 * The separator is a space, '-', '/', '_' or '.'.
 */
const FLAT_PATTERN = /(?<![A-Za-z0-9])[Tt][\s\-/_.]?(\d{1,6})(?:([\s\-/_.])(\d{3,4}))?(?!\d)/g;

/**
 * Finds the flat references in free text. A reference is read two ways: split
 * where the separator is, and as one run of digits split after a 1 or 2 digit
 * tower. Each way must pass the range rules. One valid code is returned as
 * certain; two or more valid codes are all returned with `ambiguous` true.
 *
 * The letter T is required. Digits alone (a phone number, a UPI reference, a
 * date, an amount, a cheque number) never give a flat code.
 */
export function extractFlatTokens(text: string): FlatToken[] {
  const tokens: FlatToken[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(FLAT_PATTERN)) {
    const [matchedText, first, separator, second] = match;
    const codes = new Set<string>();
    if (separator !== undefined) {
      const split = normalizeFlatCodeParts(first, second);
      if (split !== null) codes.add(split);
    }
    const digits = first + (second ?? "");
    for (const towerLength of [1, 2]) {
      const joined = normalizeFlatCodeParts(digits.slice(0, towerLength), digits.slice(towerLength));
      if (joined !== null) codes.add(joined);
    }
    for (const code of codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      tokens.push({ code, ambiguous: codes.size > 1, matchedText });
    }
  }
  return tokens;
}
