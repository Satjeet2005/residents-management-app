import { buildBase } from "./base";
import { generateNegatives } from "./negatives";
import { makeItem } from "./perturb";
import { itemRng } from "./prng";
import { LANGUAGE_FORMS, type BasePhrase, type BenchmarkItem, type LanguageForm, type NegativeItem } from "./types";

/** The two sets. The development set may be used to find bugs in the benchmark; the holdout is generated and run once, after the dev set is frozen. */
export const SETS = {
  dev: [301, 302, 303, 304, 305],
  holdout: [9301, 9302, 9303, 9304, 9305],
} as const;
export type SetName = keyof typeof SETS;
export const SINGLE_PER_SEED = 1000;
export const DOUBLE_PER_SEED = 500;
export const NEGATIVE_SIZES = { bodies: 100, perForm: 40, nearMiss: 50 } as const;

export type GeneratedSeed = { seed: number; single: BenchmarkItem[]; double: BenchmarkItem[]; negatives: NegativeItem[] };

let phrasesByForm: Record<LanguageForm, readonly BasePhrase[]> | undefined;
const phrases = (): Record<LanguageForm, readonly BasePhrase[]> => {
  if (phrasesByForm === undefined) {
    const all = buildBase().phrases;
    phrasesByForm = Object.fromEntries(LANGUAGE_FORMS.map((form) => [form, all.filter((p) => p.form === form)])) as Record<LanguageForm, BasePhrase[]>;
  }
  return phrasesByForm;
};

/** Everything one seed makes: 1,000 single-operation items, 500 double-operation items and the negatives. Item i depends only on (seed, kind, i). */
export function generateSeed(seed: number): GeneratedSeed {
  const byForm = phrases();
  const make = (kind: "single" | "double", count: 1 | 2, size: number): BenchmarkItem[] =>
    Array.from({ length: size }, (_, i) => makeItem(byForm, LANGUAGE_FORMS, count, itemRng(seed, kind, i)));
  return { seed, single: make("single", 1, SINGLE_PER_SEED), double: make("double", 2, DOUBLE_PER_SEED), negatives: generateNegatives(seed, NEGATIVE_SIZES) };
}

const line = (value: unknown): string => JSON.stringify(value);

/** One line per generated text with its truth, in order: the text a digest is taken of. */
export function canonicalSerialisation(g: GeneratedSeed): string {
  const positive = (kind: string, items: readonly BenchmarkItem[]) => items.map((i) => line([kind, i.text, i.category, i.form, i.base, i.ruleId, i.operations]));
  const negative = g.negatives.map((n) => line(["negative", n.text, n.group]));
  return [...positive("single", g.single), ...positive("double", g.double), ...negative].join("\n");
}
