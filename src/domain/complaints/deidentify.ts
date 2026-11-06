import { extractFlatTokens } from "../matching/flat-code";

export type ReplacementType = "PHONE" | "EMAIL" | "FLAT" | "NAME" | "URL";
export type Replacement = { type: ReplacementType; count: number };
export type DeidentifyContext = { knownNames: readonly string[] };
export type Deidentified = { text: string; replacements: Replacement[] };

const PLACEHOLDER: Record<ReplacementType, string> = { PHONE: "[PHONE]", EMAIL: "[EMAIL]", FLAT: "[FLAT]", NAME: "[NAME]", URL: "[URL]" };
const ORDER: readonly ReplacementType[] = ["PHONE", "EMAIL", "URL", "FLAT", "NAME"];
/** A known name equal to one of these words would match the placeholders themselves, so it is never replaced alone (keeps the result stable when run twice). */
const PLACEHOLDER_WORDS = new Set(["phone", "email", "flat", "name", "url"]);
const MIN_NAME_TOKEN = 3;

const DIGIT = "[0-9\\u0966-\\u096F]";
const NOT_ALNUM_BEFORE = "(?<![\\p{L}\\p{M}\\p{N}])";
const NOT_ALNUM_AFTER = "(?![\\p{L}\\p{M}\\p{N}])";

/** local@domain, with or without a dot in the domain, so a UPI address such as "aamir.s@oksbi" goes too. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'\])}]+/gi;
/**
 * A run of ten or more digits (ASCII or Devanagari), which may be split by spaces, hyphens, dots or round brackets, and may start with +, 91 or 0:
 * "9876543210", "98765 43210", "+91-98765-43210", "०९८७६५४३२१०". Any run of ten or more digits goes, not only a phone number: a card or an account number is
 * personal data too, and nothing the classification needs is that long.
 */
const PHONE = new RegExp(`(?<!${DIGIT})\\+?${DIGIT}(?:[\\s\\-.()]{0,2}${DIGIT}){9,}(?!${DIGIT})`, "gu");
/** An honorific (any of Mr, Mrs, Ms, Shri, Smt, Sri, Dr, Mister, in lower case, capitalised or all capitals) and the one or two capitalised words after it. No `i` flag: with it \p{Lu} would match lower case. */
const HONORIFIC = /(?<![\p{L}\p{M}\p{N}])(?:[Mm]ister|MISTER|[Mm]rs?|MRS?|[Mm]s|MS|[Ss]hri|SHRI|[Ss]mt|SMT|[Ss]ri|SRI|[Dd]r|DR)\.?[ \t]+\p{Lu}[\p{Script=Latin}'-]+(?:[ \t]+\p{Lu}[\p{Script=Latin}'-]+)?/gu;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces every match and counts them; `keep` can refuse a match (it stays as it was). */
function replaceAll(text: string, pattern: RegExp, placeholder: string, keep?: (match: string) => boolean): { text: string; count: number } {
  let count = 0;
  const out = text.replace(pattern, (match) => {
    if (keep !== undefined && !keep(match)) return match;
    count += 1;
    return placeholder;
  });
  return { text: out, count };
}

/** Flat codes, found by the matcher's own reader (`extractFlatTokens`), once per spelling, until none is left. */
function replaceFlats(text: string): { text: string; count: number } {
  let current = text;
  let count = 0;
  for (let round = 0; round < 20; round++) {
    const spellings = [...new Set(extractFlatTokens(current).map((t) => t.matchedText))].sort((a, b) => b.length - a.length);
    if (spellings.length === 0) break;
    for (const spelling of spellings) {
      const parts = current.split(spelling);
      count += parts.length - 1;
      current = parts.join(PLACEHOLDER.FLAT);
    }
  }
  return { text: current, count };
}

/** Whole names first (so "Aamir Shaikh" is one [NAME]), then each word of a name of at least 3 characters. */
function replaceKnownNames(text: string, knownNames: readonly string[]): { text: string; count: number } {
  const full = new Set<string>();
  const tokens = new Set<string>();
  for (const name of knownNames) {
    if (typeof name !== "string") continue;
    const words = name.normalize("NFC").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (words.length > 1) full.add(words.join(" "));
    for (const word of words) if (Array.from(word).length >= MIN_NAME_TOKEN && !PLACEHOLDER_WORDS.has(word.toLowerCase())) tokens.add(word);
  }
  const phrases = [...full].sort((a, b) => b.length - a.length);
  const words = [...tokens].sort((a, b) => b.length - a.length);
  let current = text;
  let count = 0;
  for (const phrase of phrases) {
    const pattern = new RegExp(`${NOT_ALNUM_BEFORE}${phrase.split(" ").map(escapeRegExp).join("\\s+")}${NOT_ALNUM_AFTER}`, "giu");
    const result = replaceAll(current, pattern, PLACEHOLDER.NAME);
    current = result.text;
    count += result.count;
  }
  for (const word of words) {
    const result = replaceAll(current, new RegExp(`${NOT_ALNUM_BEFORE}${escapeRegExp(word)}${NOT_ALNUM_AFTER}`, "giu"), PLACEHOLDER.NAME);
    current = result.text;
    count += result.count;
  }
  return { text: current, count };
}

/**
 * Takes personal data out of a complaint before it goes to a third party (human decision: de-identified text only). It replaces phone numbers
 * ([PHONE]), e-mail addresses ([EMAIL]), web addresses ([URL]), flat codes ([FLAT]), a Latin honorific (Mr, Mrs, Ms, Shri, Smt, Sri, Dr, Mister)
 * with the capitalised name after it, and the names in `knownNames` ([NAME]); zero-width characters are removed first so they cannot hide a number.
 * It is idempotent, never throws, and returns only the kinds it replaced, with counts.
 *
 * LIMITS, plainly: it CANNOT guarantee that all personal data is gone. It does not know a name that is not in `knownNames` and has no honorific,
 * an address, a building name, a vehicle number, an account number shorter than ten digits, or a detail given in the sentences themselves ("my
 * husband works at ..."). A name in Devanagari is replaced only when it is given exactly in `knownNames` and stands alone as a word (an inflected
 * form such as "आमिरला" is not). A honorific in Devanagari (श्री) is not read. After an honorific up to two capitalised words go, so a sentence-start word that follows ("Dr Mehta Please fix") goes too. A word that is both a name and an ordinary word ("Rose") is replaced
 * wherever it stands. Keep the raw text for people; send only this to a model, and treat it as reduced risk, never as anonymous.
 */
export function deidentify(text: string, context: DeidentifyContext): Deidentified {
  const counts: Record<ReplacementType, number> = { PHONE: 0, EMAIL: 0, FLAT: 0, NAME: 0, URL: 0 };
  let current = String(text ?? "").normalize("NFC").replace(/[​-‍﻿]/g, "");

  const email = replaceAll(current, EMAIL, PLACEHOLDER.EMAIL);
  current = email.text;
  counts.EMAIL = email.count;
  const url = replaceAll(current, URL_PATTERN, PLACEHOLDER.URL);
  current = url.text;
  counts.URL = url.count;
  const phone = replaceAll(current, PHONE, PLACEHOLDER.PHONE);
  current = phone.text;
  counts.PHONE = phone.count;
  const flat = replaceFlats(current);
  current = flat.text;
  counts.FLAT = flat.count;
  const honorific = replaceAll(current, HONORIFIC, PLACEHOLDER.NAME);
  current = honorific.text;
  const names = replaceKnownNames(current, Array.isArray(context?.knownNames) ? context.knownNames : []);
  current = names.text;
  counts.NAME = honorific.count + names.count;

  return { text: current, replacements: ORDER.filter((type) => counts[type] > 0).map((type) => ({ type, count: counts[type] })) };
}
