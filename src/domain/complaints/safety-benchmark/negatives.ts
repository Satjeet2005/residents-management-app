import { complaintBody } from "../../seed/complaint-text";
import { createPrng } from "../../seed/prng";
import { CONTEXTS, embed } from "./contexts";
import { createRng, mixSeed } from "./prng";
import { TEST_NEGATIVES } from "./test-negatives";
import { LANGUAGE_FORMS, type LanguageForm, type NegativeItem } from "./types";

/** Seed complaint templates: ordinary complaints of a township, none of them an emergency. */
const BODY_CATEGORIES = ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"] as const;

/** Ordinary things a resident writes about, per language form; each goes inside a benign context. */
const BENIGN: Readonly<Record<LanguageForm, readonly string[]>> = {
  ENGLISH: ["water tank overflow", "parking slot problem", "tube light in the passage", "garbage pickup timing", "gate intercom", "garden bench", "name plate", "maintenance bill", "society meeting", "visitor entry register", "staircase cleaning", "water pressure", "dripping tap", "notice board", "club house booking", "lift display"],
  HINDI_DEVANAGARI: ["पानी की टंकी", "पार्किंग की जगह", "ट्यूब लाइट", "कचरा उठाने का समय", "गेट की घंटी", "बगीचे की बेंच", "रखरखाव का बिल", "सोसाइटी की मीटिंग", "सीढ़ियों की सफाई", "पानी का दबाव", "नल से पानी टपकना", "सूचना पट्ट", "क्लब हाउस की बुकिंग", "लिफ्ट का डिस्प्ले"],
  MARATHI_DEVANAGARI: ["पाण्याची टाकी", "पार्किंगची जागा", "ट्यूब लाईट", "कचरा उचलण्याची वेळ", "गेटची बेल", "बागेतील बाक", "देखभालीचे बिल", "सोसायटीची बैठक", "पायऱ्यांची साफसफाई", "पाण्याचा दाब", "नळ टपकणे", "सूचना फलक", "क्लब हाऊसचे बुकिंग", "लिफ्टचा डिस्प्ले"],
  ROMANISED_HINDI: ["paani ki tanki", "parking ki jagah", "tube light", "kachra uthane ka time", "gate ki ghanti", "bagiche ki bench", "maintenance ka bill", "society ki meeting", "seedhiyon ki safai", "paani ka pressure", "nal se paani tapakna", "notice board", "club house ki booking", "lift ka display"],
  ROMANISED_MARATHI: ["paanyachi tanki", "parkingchi jaga", "tube light", "kachra uchalnyachi vel", "gatechi bell", "bagetil bench", "maintenancche bill", "societychi meeting", "payryanchi safai", "paanyacha daab", "nal tapaktoy", "suchna phalak", "club housche booking", "liftcha display"],
};

/**
 * Words close to a safety word, or that share its letters, in a sentence that is NOT an emergency. Some are known to hit a rule (a word of a
 * rule that also means something harmless): they are false alarms and are reported as such, never hidden.
 */
export const NEAR_MISS_WORDS: Readonly<Record<LanguageForm, readonly string[]>> = {
  ENGLISH: ["fine", "five", "hire", "wire", "tire", "fare", "gust", "gasket", "gastric", "shocking", "current account", "liftoff", "fireplace", "bloodwork", "blood donation", "knifeblock", "kitchen knife set", "ambulatory", "firm", "gaze", "lifted", "smokeless", "flu shot", "photo shot", "gunmetal grey", "burn rate", "firewall", "fireworks", "stroke of luck", "dead end road"],
  HINDI_DEVANAGARI: ["आगे", "आगामी", "आगरा", "आगंतुक", "भागना", "जलपान", "जल विभाग", "झटका", "रक्तदान शिविर", "दवा की गोली", "करंट अकाउंट", "लिफ्ट बंद", "बिजली गई", "मौत का कुआँ फिल्म", "गैस लाइटर"],
  MARATHI_DEVANAGARI: ["धुरळा", "धुरंधर", "आगामी", "जळगाव", "मारुती", "रक्तदान शिबिर", "वीज गेली", "लिफ्ट बंद", "गॅस बिल", "करंट अकाउंट", "जखमा भरणारे मलम", "धक्काबुक्की"],
  ROMANISED_HINDI: ["aage", "aagaman", "aagar", "dhuri", "jalebi", "jaldi", "jalpan", "hamara", "halka", "marathi", "goli ki dawa", "current account", "bijli gayi", "lift band", "khuni rang", "gas lighter"],
  ROMANISED_MARATHI: ["dhurandhar", "aagamini", "jalgaon", "maruti", "rakta dan shibir", "vij gelit", "lift band", "gas bill", "current account", "halkaa", "marathi shala", "dhakkabukki"],
};

const dedupe = (items: NegativeItem[]): NegativeItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.text) ? false : (seen.add(item.text), true)));
};

/**
 * The benign sentences of one seed: complaint bodies from the seed templates, benign topics inside the contexts of each language form, and
 * near-miss words inside the same contexts. No sentence is filtered for the detector: a hit is a false alarm and is counted.
 */
export function generateNegatives(seed: number, sizes: { bodies: number; perForm: number; nearMiss: number }): NegativeItem[] {
  const bodies = createPrng(mixSeed(seed, "negative-bodies"));
  const rng = createRng(mixSeed(seed, "negatives"));
  const generated: NegativeItem[] = [];
  for (let i = 0; i < sizes.bodies; i++) generated.push({ text: complaintBody(bodies, bodies.pick(BODY_CATEGORIES)), group: "GENERATED" });
  for (const form of LANGUAGE_FORMS) {
    for (let i = 0; i < sizes.perForm; i++) generated.push({ text: embed(rng.pick(CONTEXTS[form]), rng.pick(BENIGN[form])), group: "GENERATED" });
  }
  const near: NegativeItem[] = [];
  for (let i = 0; i < sizes.nearMiss; i++) {
    const form = rng.pick(LANGUAGE_FORMS);
    near.push({ text: embed(rng.pick(CONTEXTS[form]), rng.pick(NEAR_MISS_WORDS[form])), group: "NEAR_MISS" });
  }
  return [...dedupe(generated), ...dedupe(near)];
}

/** The negative sentences of the existing safety tests, as a group of their own (they hit nothing by construction). */
export const existingNegatives = (): NegativeItem[] => dedupe(TEST_NEGATIVES.map((text) => ({ text, group: "EXISTING" as const })));
