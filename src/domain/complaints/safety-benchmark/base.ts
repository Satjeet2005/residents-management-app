import { SAFETY_RULES, detectSafetyWords } from "../safety";
import { TEST_POSITIVES } from "./test-positives";
import type { BasePhrase, LanguageForm } from "./types";

const FORM_OF_LANGUAGE: Readonly<Record<string, LanguageForm>> = {
  en: "ENGLISH",
  hi: "HINDI_DEVANAGARI",
  mr: "MARATHI_DEVANAGARI",
  "hi-Latn": "ROMANISED_HINDI",
  "mr-Latn": "ROMANISED_MARATHI",
};

export type DroppedPhrase = { text: string; ruleId: string; source: BasePhrase["source"] };
export type BaseList = { phrases: readonly BasePhrase[]; dropped: readonly DroppedPhrase[] };

/**
 * The canonical positive phrases, without changing a rule: (a) every term of every rule in the table, (b) the words each rule matched in every
 * positive case of the existing safety tests. A phrase is kept only when its own rule hits it on its own today; the others are dropped and listed.
 */
export function buildBase(): BaseList {
  const candidates: { text: string; ruleId: string; source: BasePhrase["source"] }[] = [];
  for (const rule of SAFETY_RULES) for (const term of rule.terms) candidates.push({ text: term, ruleId: rule.id, source: "RULE_TABLE" });
  for (const [sentence, ruleId] of TEST_POSITIVES) {
    const hit = detectSafetyWords(sentence).find((h) => h.rule === ruleId);
    if (hit !== undefined) candidates.push({ text: hit.matched, ruleId, source: "TEST_CASE" });
  }
  const ruleById = new Map(SAFETY_RULES.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const phrases: BasePhrase[] = [];
  const dropped: DroppedPhrase[] = [];
  for (const { text, ruleId, source } of candidates) {
    const key = `${ruleId}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rule = ruleById.get(ruleId);
    if (rule === undefined || !detectSafetyWords(text).some((h) => h.rule === ruleId)) {
      dropped.push({ text, ruleId, source });
      continue;
    }
    phrases.push({ text, category: rule.category, form: FORM_OF_LANGUAGE[rule.language], ruleId, source });
  }
  return { phrases, dropped };
}
