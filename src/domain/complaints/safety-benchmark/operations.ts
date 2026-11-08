import type { Rng } from "./prng";
import type { LanguageForm } from "./types";

/** One way of damaging the letters of safety words. `apply` returns null when it cannot change this text (the generator then tries another operation). */
export type Operation = { name: string; scripts: readonly Script[]; apply(text: string, rng: Rng): string | null };
type Script = "LATIN" | "ROMANISED" | "DEVANAGARI";

const QWERTY: Readonly<Record<string, string>> = {
  q: "wa", w: "qes", e: "wrd", r: "etf", t: "ryg", y: "tuh", u: "yij", i: "uok", o: "ipl", p: "ol",
  a: "qsz", s: "awdx", d: "serfc", f: "drgv", g: "ftvhb", h: "gyjnb", j: "huknm", k: "jilm", l: "kop", z: "asx",
  x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
};

const LETTER = /[a-z]/i;
const VOWEL = /[aeiou]/i;
const chars = (text: string): string[] => Array.from(text);
const choose = (candidates: string[], rng: Rng): string | null => (candidates.length === 0 ? null : rng.pick(candidates));
const letterIndexes = (c: readonly string[]): number[] => c.flatMap((ch, i) => (LETTER.test(ch) ? [i] : []));
const edit = (c: readonly string[], i: number, remove: number, ...insert: string[]): string => [...c.slice(0, i), ...insert, ...c.slice(i + remove)].join("");

const swapAdjacent = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (i + 1 < c.length && LETTER.test(ch) && LETTER.test(c[i + 1]) && ch.toLowerCase() !== c[i + 1].toLowerCase() ? [edit(c, i, 2, c[i + 1], ch)] : [])), rng);
};
const dropLetter = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return c.filter((ch) => LETTER.test(ch)).length < 2 ? null : choose(letterIndexes(c).map((i) => edit(c, i, 1)), rng);
};
const doubleLetter = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(letterIndexes(c).map((i) => edit(c, i, 0, c[i])), rng);
};
const neighbours = (letter: string): string[] => Array.from(QWERTY[letter.toLowerCase()] ?? "");
const insertNeighbour = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(letterIndexes(c).flatMap((i) => neighbours(c[i]).flatMap((n) => [edit(c, i, 0, n), edit(c, i + 1, 0, n)])), rng);
};
const substituteNeighbour = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(letterIndexes(c).flatMap((i) => neighbours(c[i]).map((n) => edit(c, i, 1, n))), rng);
};
const elongateVowel = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (VOWEL.test(ch) ? [edit(c, i, 1, ch, ch, ch)] : [])), rng);
};
const randomCase = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  const indexes = letterIndexes(c);
  if (indexes.length === 0) return null;
  const out = c.map((ch) => (LETTER.test(ch) ? (rng.next() < 0.5 ? ch.toUpperCase() : ch.toLowerCase()) : ch)).join("");
  if (out !== text) return out;
  const flip = rng.pick(indexes);
  return edit(c, flip, 1, c[flip] === c[flip].toUpperCase() ? c[flip].toLowerCase() : c[flip].toUpperCase());
};
const insertSeparator = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (i + 1 < c.length && LETTER.test(ch) && LETTER.test(c[i + 1]) ? [edit(c, i + 1, 0, " "), edit(c, i + 1, 0, ".")] : [])), rng);
};
const removeSpaces = (text: string): string | null => {
  if (!LETTER.test(text)) return null;
  const out = text.replace(/[\s\-_]+/g, "");
  return out === text ? null : out;
};
const LEET: Readonly<Record<string, readonly string[]>> = { o: ["0"], i: ["1"], e: ["3"], a: ["4", "@"], s: ["5", "$"] };
const leet = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  const eligible = c.flatMap((ch, i) => (LEET[ch.toLowerCase()] !== undefined ? [i] : []));
  if (eligible.length === 0) return null;
  const forced = rng.pick(eligible);
  return c.map((ch, i) => (LEET[ch.toLowerCase()] !== undefined && (i === forced || rng.next() < 0.5) ? rng.pick(LEET[ch.toLowerCase()]) : ch)).join("");
};
const ROMANISATION_PAIRS: readonly (readonly [string, string])[] = [["aa", "a"], ["a", "aa"], ["ee", "i"], ["i", "ee"], ["oo", "u"], ["u", "oo"], ["v", "w"], ["w", "v"], ["ph", "f"], ["f", "ph"]];
const romanisationVariant = (text: string, rng: Rng): string | null => {
  const lower = text.toLowerCase();
  if (!LETTER.test(text)) return null;
  const candidates: string[] = [];
  for (const [from, to] of ROMANISATION_PAIRS) {
    for (let at = lower.indexOf(from); at !== -1; at = lower.indexOf(from, at + 1)) candidates.push(text.slice(0, at) + to + text.slice(at + from.length));
  }
  if (LETTER.test(lower.slice(-1))) candidates.push(`${text}a`, `${text}h`);
  if (/[^\s\-_][ah]$/.test(lower)) candidates.push(text.slice(0, -1));
  return choose(candidates, rng);
};

/** Devanagari signs by code point: nukta U+093C, chandrabindu U+0901, anusvara U+0902, vowel signs U+093E to U+094C, ZWJ U+200D, ZWNJ U+200C. */
const NUKTA = "\u093c";
const NUKTA_CONSONANTS = new Set(["क", "ख", "ग", "ज", "ड", "ढ", "फ"]);
const isConsonant = (ch: string): boolean => ch >= "\u0915" && ch <= "\u0939";
const isVowelSign = (ch: string): boolean => ch >= "\u093e" && ch <= "\u094c";
const isDevanagari = (ch: string): boolean => ch >= "\u0900" && ch <= "\u097f";
const nuktaToggle = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (ch === NUKTA ? [edit(c, i, 1)] : NUKTA_CONSONANTS.has(ch) && c[i + 1] !== NUKTA ? [edit(c, i + 1, 0, NUKTA)] : [])), rng);
};
const chandrabinduAnusvara = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (ch === "\u0901" ? [edit(c, i, 1, "\u0902")] : ch === "\u0902" ? [edit(c, i, 1, "\u0901")] : [])), rng);
};
const insertJoiner = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (i > 0 && isDevanagari(ch) && isDevanagari(c[i - 1]) ? [edit(c, i, 0, "\u200d"), edit(c, i, 0, "\u200c")] : [])), rng);
};
const VOWEL_SWAP: Readonly<Record<string, string>> = { "\u093f": "\u0940", "\u0940": "\u093f", "\u0941": "\u0942", "\u0942": "\u0941" };
const swapVowelLength = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (VOWEL_SWAP[ch] !== undefined ? [edit(c, i, 1, VOWEL_SWAP[ch])] : [])), rng);
};
const dropVowelSign = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (isVowelSign(ch) ? [edit(c, i, 1)] : [])), rng);
};
const doubleConsonant = (text: string, rng: Rng): string | null => {
  const c = chars(text);
  return choose(c.flatMap((ch, i) => (isConsonant(ch) ? [edit(c, i, 0, ch)] : [])), rng);
};

export const OPERATIONS: readonly Operation[] = [
  { name: "SWAP_ADJACENT", scripts: ["LATIN", "ROMANISED"], apply: swapAdjacent },
  { name: "DROP_LETTER", scripts: ["LATIN", "ROMANISED"], apply: dropLetter },
  { name: "DOUBLE_LETTER", scripts: ["LATIN", "ROMANISED"], apply: doubleLetter },
  { name: "INSERT_NEIGHBOUR", scripts: ["LATIN", "ROMANISED"], apply: insertNeighbour },
  { name: "SUBSTITUTE_NEIGHBOUR", scripts: ["LATIN", "ROMANISED"], apply: substituteNeighbour },
  { name: "ELONGATE_VOWEL", scripts: ["LATIN", "ROMANISED"], apply: elongateVowel },
  { name: "RANDOM_CASE", scripts: ["LATIN", "ROMANISED"], apply: randomCase },
  { name: "INSERT_SEPARATOR", scripts: ["LATIN", "ROMANISED"], apply: insertSeparator },
  { name: "REMOVE_SPACES", scripts: ["LATIN", "ROMANISED"], apply: removeSpaces },
  { name: "LEET", scripts: ["LATIN", "ROMANISED"], apply: leet },
  { name: "ROMANISATION_VARIANT", scripts: ["ROMANISED"], apply: romanisationVariant },
  { name: "NUKTA_TOGGLE", scripts: ["DEVANAGARI"], apply: nuktaToggle },
  { name: "CHANDRABINDU_ANUSVARA", scripts: ["DEVANAGARI"], apply: chandrabinduAnusvara },
  { name: "INSERT_JOINER", scripts: ["DEVANAGARI"], apply: insertJoiner },
  { name: "SWAP_VOWEL_LENGTH", scripts: ["DEVANAGARI"], apply: swapVowelLength },
  { name: "DROP_VOWEL_SIGN", scripts: ["DEVANAGARI"], apply: dropVowelSign },
  { name: "DOUBLE_CONSONANT", scripts: ["DEVANAGARI"], apply: doubleConsonant },
];

const SCRIPT_OF_FORM: Readonly<Record<LanguageForm, Script>> = {
  ENGLISH: "LATIN",
  HINDI_DEVANAGARI: "DEVANAGARI",
  MARATHI_DEVANAGARI: "DEVANAGARI",
  ROMANISED_HINDI: "ROMANISED",
  ROMANISED_MARATHI: "ROMANISED",
};

/** The operations that apply to a language form; the others are skipped for it. */
export const operationsFor = (form: LanguageForm): readonly Operation[] => OPERATIONS.filter((op) => op.scripts.includes(SCRIPT_OF_FORM[form]));
