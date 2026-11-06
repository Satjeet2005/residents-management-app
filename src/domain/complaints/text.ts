/** The most characters of a complaint that are read for classification. The raw text is never cut or changed anywhere else. */
export const MAX_CLASSIFICATION_CHARS = 2000;

const ZERO_WIDTH = /[​-‍﻿]/g;
const DEVANAGARI_DIGITS = /[०-९]/g;

/**
 * The text as the classification rules read it: Unicode NFC, zero-width characters (U+200B to U+200D, U+FEFF) removed, Devanagari digits
 * turned into ASCII digits, runs of whitespace made one space, trimmed, and cut to 2,000 characters (by code point, so a pair of
 * surrogates is never split). Pure and total: it never throws, and the caller keeps the raw text.
 */
export function normalizeComplaintText(raw: string): string {
  const text = String(raw ?? "")
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(DEVANAGARI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(text);
  return characters.length <= MAX_CLASSIFICATION_CHARS ? text : characters.slice(0, MAX_CLASSIFICATION_CHARS).join("").trim();
}

export type ScriptKind = "LATIN" | "DEVANAGARI" | "MIXED" | "OTHER" | "EMPTY";
export type ScriptInfo = { script: ScriptKind; devanagariShare: number; latinShare: number };

const LATIN_LETTER = /\p{Script=Latin}/u;
const DEVANAGARI_LETTER = /[\p{Script=Devanagari}]/u;
const ANY_LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const MARK = /\p{M}/u;

/**
 * Which script a text is mostly written in. Only letters and the vowel signs of Devanagari count (digits, spaces, punctuation and emoji do
 * not). LATIN or DEVANAGARI when at least 90 percent of the counted characters are that script, MIXED when both are present in
 * meaningful amounts, OTHER when other scripts dominate or there are no letters at all (an emoji), EMPTY for an empty or blank text.
 * The shares are of all counted letters, 0 to 1.
 */
export function detectScript(text: string): ScriptInfo {
  const source = String(text ?? "");
  if (source.trim() === "") return { script: "EMPTY", devanagariShare: 0, latinShare: 0 };
  let devanagari = 0;
  let latin = 0;
  let other = 0;
  for (const character of source) {
    if (DIGIT.test(character)) continue;
    if (DEVANAGARI_LETTER.test(character) && (ANY_LETTER.test(character) || MARK.test(character))) devanagari += 1;
    else if (LATIN_LETTER.test(character) && ANY_LETTER.test(character)) latin += 1;
    else if (ANY_LETTER.test(character)) other += 1;
  }
  const total = devanagari + latin + other;
  if (total === 0) return { script: "OTHER", devanagariShare: 0, latinShare: 0 };
  const devanagariShare = devanagari / total;
  const latinShare = latin / total;
  if (other / total > 0.5) return { script: "OTHER", devanagariShare, latinShare };
  if (devanagariShare >= 0.9) return { script: "DEVANAGARI", devanagariShare, latinShare };
  if (latinShare >= 0.9) return { script: "LATIN", devanagariShare, latinShare };
  return { script: "MIXED", devanagariShare, latinShare };
}

/**
 * Common Hindi and Marathi words as people type them in Latin letters ("Hinglish"). Words that are also ordinary English words (me, do, to,
 * the, main, par, is, band, leak) are left out on purpose, so an English sentence is not taken for Hinglish.
 */
export const ROMANISED_INDIC_WORDS: readonly string[] = [
  "ka", "ki", "ke", "ko", "hai", "hain", "nahi", "nahin", "mein", "se", "aur", "yeh", "kya", "kyun", "kab", "abhi", "bahut", "jaldi", "turant", "kripya",
  "paani", "pani", "bijli", "kachra", "safai", "nal", "kharab", "chalu", "toot", "tut", "gaya", "gayi", "gaye", "raha", "rahi", "rahe",
  "laga", "lagi", "lage", "ho", "hua", "hui", "karo", "kijiye", "dikkat", "samasya", "madad", "ghar", "mera", "meri", "hamare", "hamari", "sab", "wala", "wali",
  "aahe", "ahe", "ahet", "zala", "zali", "jhala", "jhali", "kay", "kuthe", "lavkar", "tatkal", "vij", "mala", "amchya", "tumhi", "nahiye", "pahije", "zhale",
];

const ROMANISED_PHRASES: readonly string[] = ["lift band", "paani nahi", "bijli nahi", "pani nahi", "nahi aa", "kaam nahi"];

/**
 * A guess, not a language detector: true when the Latin-letter text contains at least two common Hindi or Marathi words, or a known phrase, or
 * when one such word is at least a third of a short text. KNOWN LIMITS: a single Hindi word in an English sentence is not enough; Hindi that uses
 * only words outside the list is missed; an English sentence that happens to hold two of the short words ("ho", "se", "ka", "ki") is taken for
 * Hinglish; spelling varies a great deal ("paani", "pani", "paanee"). It is used only to choose how to read a text, never to refuse one.
 */
export function looksRomanisedIndic(text: string): boolean {
  const lower = normalizeComplaintText(text).toLowerCase();
  const words = lower.match(/[a-z]+/g) ?? [];
  if (words.length === 0) return false;
  if (ROMANISED_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  const known = new Set(ROMANISED_INDIC_WORDS);
  const hits = words.filter((word) => known.has(word)).length;
  return hits >= 2 || (hits >= 1 && hits / words.length >= 1 / 3);
}
