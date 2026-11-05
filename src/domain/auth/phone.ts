/** Mobile numbers in India are 10 digits and start with 5 to 9 (5 is used only by our fictional numbers). */
const NATIONAL_DIGITS = 10;
const COUNTRY_CODE = "91";
const SEPARATORS = /[ \-()]/g;

/**
 * The 10-digit national number, or null.
 *
 * Accepted: spaces, hyphens and round brackets anywhere; a leading `+91`, `91` or `0`; nothing else.
 * Rejected: letters or any other character, a `+` that is not first, another country code, a wrong
 * number of digits, and a first national digit outside 5 to 9.
 * A 10-digit input is always read as national, so `9187654321` is not a country code.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(SEPARATORS, "");
  const plus = compact.startsWith("+");
  const digits = plus ? compact.slice(1) : compact;
  if (!/^[0-9]+$/.test(digits)) return null;

  let national: string;
  if (plus) {
    if (!digits.startsWith(COUNTRY_CODE) || digits.length !== COUNTRY_CODE.length + NATIONAL_DIGITS) return null;
    national = digits.slice(COUNTRY_CODE.length);
  } else if (digits.length === NATIONAL_DIGITS) {
    national = digits;
  } else if (digits.length === NATIONAL_DIGITS + 1 && digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length === NATIONAL_DIGITS + COUNTRY_CODE.length && digits.startsWith(COUNTRY_CODE)) {
    national = digits.slice(COUNTRY_CODE.length);
  } else {
    return null;
  }
  return /^[5-9]/.test(national) ? national : null;
}

/** Our fictional numbers start with 5. No real mobile number does. */
export function isDemoPhone(national: string): boolean {
  return national.startsWith("5");
}
