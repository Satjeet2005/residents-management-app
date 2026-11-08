/**
 * Stage 1 of the safety-detection improvement (T10c, D168): normalisation. `normalizeForSafety` makes a few extra readings of the RAW text so the
 * existing matcher can see a safety word through typing noise. It adds no word and no rule. Every candidate is derived from the raw text on its own
 * (never from another candidate), the raw text itself is never changed anywhere else, and the function never throws.
 */

/** How a hit was found: in the text as it was read until now (EXACT), or in one of the extra readings below. */
export type SafetyVia = "EXACT" | "NORMALISED" | "SQUASHED" | "ELONGATION" | "LEET";
export type SafetyCandidate = { via: Exclude<SafetyVia, "EXACT">; text: string };

/** The longest candidate, in characters (code points) and in whitespace-separated words. */
export const MAX_CANDIDATE_CHARS = 2000;
export const MAX_CANDIDATE_TOKENS = 400;
/** More than this many characters of the raw text are not read by the extra candidates (the exact reading still sees them); it bounds the cost. */
const MAX_RAW_CHARS = 20_000;

const ZERO_WIDTH_AND_SELECTORS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u180E\uFEFF\uFE00-\uFE0F]/g;
const VARIATION_SELECTORS_SUPPLEMENT = /[\u{E0100}-\u{E01EF}]/gu;
const LATIN_COMBINING_MARKS = /[\u0300-\u036F]/g;
const DEVANAGARI_DIGITS = /[\u0966-\u096F]/g;

/** The base reading: NFKC, lower case, zero-width characters and variation selectors out, Latin diacritics stripped, Devanagari digits as ASCII, one space between words. */
export function baseForm(raw: string): string {
  return String(raw ?? "")
    .slice(0, MAX_RAW_CHARS)
    .normalize("NFKC")
    .toLowerCase()
    .replace(ZERO_WIDTH_AND_SELECTORS, "")
    .replace(VARIATION_SELECTORS_SUPPLEMENT, "")
    .normalize("NFD")
    .replace(LATIN_COMBINING_MARKS, "")
    .normalize("NFC")
    .replace(DEVANAGARI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(/\s+/g, " ")
    .trim();
}

/** One letter with its vowel signs, then at least two more, each after exactly one space, dot, dash or underscore: "f i r e", "f.i.r.e", "f-i-r-e", "f_i_r_e". */
const SINGLE_LETTER_RUN = /(?<![\p{L}\p{M}\p{N}])\p{L}\p{M}*(?:[\s.\-_]\p{L}\p{M}*){2,}(?![\p{L}\p{M}\p{N}])/gu;

/** Runs of at least three single letters are joined ("f i r e" becomes "fire"); two letters ("a b") and ordinary words and numbers are left alone. */
export function squashSingleLetters(text: string): string {
  return text.replace(SINGLE_LETTER_RUN, (run) => run.replace(/[\s.\-_]/g, ""));
}

const THREE_OR_MORE_SAME_LETTER = /(\p{L})\1{2,}/gu;

/** Three or more repeats of a letter reduced to `keep` (2 or 1): "fiiire" becomes "fiire" (2) or "fire" (1). */
export const collapseElongation = (text: string, keep: 1 | 2): string => text.replace(THREE_OR_MORE_SAME_LETTER, keep === 2 ? "$1$1" : "$1");

const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };
const LEET_SYMBOL = /[013457@$]/;
const LATIN_LETTER = /[a-z]/;
/** A number with one letter (a flat "5b"), an ordinal ending or a common unit ("5th", "3rd", "10am", "2bhk", "5kg"): a number, never a word spelled with digits. */
const NUMBER_WITH_UNIT = /^\d+(?:[a-z]|st|nd|rd|th|am|pm|kg|gm|bhk|ft|km|cm|mm|ml|kw|hp|gb|mb|tb)$/;

/** In a word that has a Latin letter AND a symbol (0 1 3 4 5 7 @ $), the symbols become the letters they look like: "f1re" becomes "fire". "5th", "B 5" and "1 of 3" stay. */
export function foldLeet(text: string): string {
  return text
    .split(" ")
    .map((word) => (LEET_SYMBOL.test(word) && LATIN_LETTER.test(word) && !NUMBER_WITH_UNIT.test(word) ? word.replace(/[013457@$]/g, (c) => LEET[c]) : word))
    .join(" ");
}

/** Devanagari spelling variants made one: the nukta (and the letters that carry it precomposed) gone, a chandrabindu made anusvara, joiners removed. */
export function foldDevanagariVariants(text: string): string {
  return text
    .replace(/[\u0958-\u095F]/g, (letter) => letter.normalize("NFD")[0])
    .replace(/[\u093C\u200C\u200D]/g, "")
    .replace(/\u0901/g, "\u0902");
}

/** At most 2,000 characters (by code point, so a pair of surrogates is never split). */
const cutCharacters = (text: string): string => {
  const characters = Array.from(text);
  return characters.length <= MAX_CANDIDATE_CHARS ? text : characters.slice(0, MAX_CANDIDATE_CHARS).join("").trim();
};

/** At most 400 words and 2,000 characters. */
export function capCandidate(text: string): string {
  const words = text.split(" ");
  return cutCharacters(words.length > MAX_CANDIDATE_TOKENS ? words.slice(0, MAX_CANDIDATE_TOKENS).join(" ") : text);
}

/**
 * The extra readings of a raw text, in this order, a reading that equals an earlier one left out: the base reading, the squashed reading, the
 * elongation readings (repeats to two, repeats to one), the leet reading and the Devanagari-folded reading. At most six. Each is a reading of the
 * raw text on its own. The detector reads each with the existing rules and adds the hits.
 */
export function normalizeForSafety(raw: string): SafetyCandidate[] {
  // Like the exact reading, the extra readings see only the first 2,000 characters; a squashed run cannot pull a word from beyond them.
  const base = cutCharacters(baseForm(raw));
  if (base === "") return [];
  const readings: SafetyCandidate[] = [
    { via: "NORMALISED", text: base },
    { via: "SQUASHED", text: squashSingleLetters(base) },
    { via: "ELONGATION", text: collapseElongation(base, 2) },
    { via: "ELONGATION", text: collapseElongation(base, 1) },
    { via: "LEET", text: foldLeet(base) },
    { via: "NORMALISED", text: foldDevanagariVariants(base) },
  ];
  const seen = new Set<string>();
  const out: SafetyCandidate[] = [];
  for (const reading of readings) {
    const text = capCandidate(reading.text);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    out.push({ via: reading.via, text });
  }
  return out;
}
