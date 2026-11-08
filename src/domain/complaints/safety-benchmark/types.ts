import type { SafetyCategory } from "../safety";

export type LanguageForm = "ENGLISH" | "HINDI_DEVANAGARI" | "MARATHI_DEVANAGARI" | "ROMANISED_HINDI" | "ROMANISED_MARATHI";
export const LANGUAGE_FORMS: readonly LanguageForm[] = ["ENGLISH", "HINDI_DEVANAGARI", "MARATHI_DEVANAGARI", "ROMANISED_HINDI", "ROMANISED_MARATHI"];
export const SAFETY_CATEGORIES: readonly SafetyCategory[] = ["FIRE", "GAS", "LIFT_STUCK", "SHOCK", "MEDICAL_VIOLENCE"];

/** A canonical positive phrase: the words of one rule (or the words a rule matched in an existing test case), detected today without any change. */
export type BasePhrase = { text: string; category: SafetyCategory; form: LanguageForm; ruleId: string; source: "RULE_TABLE" | "TEST_CASE" };

/** One generated positive: a perturbed base phrase inside a benign context, with its ground truth. `operations` has one name (single set) or two (double set). */
export type BenchmarkItem = {
  text: string;
  category: SafetyCategory;
  form: LanguageForm;
  base: string;
  ruleId: string;
  operations: readonly string[];
};

export type NegativeGroup = "GENERATED" | "NEAR_MISS" | "EXISTING";
export type NegativeItem = { text: string; group: NegativeGroup };
