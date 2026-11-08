import { describe, expect, it } from "vitest";
import { decideClassification } from "@/domain/complaints/decision";
import { SAFETY_RULES, detectSafetyWords } from "@/domain/complaints/safety";
import { EVERYDAY_PHRASES } from "@/domain/complaints/safety-benchmark/negatives";
import { LANGUAGE_FORMS } from "@/domain/complaints/safety-benchmark/types";

/** D169: a bare "current" or करंट is the electricity of a bill or a power cut, so it hits only with a shock word in the same text. */
const CURRENT_RULES = new Set(["SHOCK_HI_KARANT", "SHOCK_MR_KARANT", "SHOCK_HI_LAG", "SHOCK_HI_LATN_CURRENT", "SHOCK_HI_LATN_JHATKA"]);
const viaCurrent = (text: string) => detectSafetyWords(text).filter((h) => CURRENT_RULES.has(h.rule));

/** Everyday electricity phrases that used to hit through a bare current rule (the 17 found by the T10c measurement) and a few like them. */
const EVERYDAY_ELECTRICITY = [
  "तीन घंटे से करंट नहीं है",
  "करंट कब आएगा बताओ",
  "करंट चला गया है सुबह से",
  "करंट नहीं आ रहा है सुबह से",
  "बिजली का करंट बिल नहीं मिला",
  "करंट आ गया है धन्यवाद",
  "बिजली का करंट बिल बहुत आया है",
  "करंट आता जाता रहता है शाम को",
  "तीन तासांपासून करंट नाही",
  "करंट गेला आहे सकाळपासून",
  "करंट कधी येणार सांगा",
  "करंट आला आहे धन्यवाद",
  "करंट येत जात आहे संध्याकाळी",
  "विजेचे करंट बिल खूप आले आहे",
  "current aa raha hai kya abhi",
  "current aata jaata rehta hai shaam ko",
  "bijli ka current bill bahut aaya hai",
  "करंट नहीं आ रहा लगातार",
  "current gaya", "current gela", "current bill", "current kab aayega", "light gayi",
];

/** Real shock phrases: each must still be a hit by a current rule or by a shock rule, exactly as before. */
const SHOCK_PHRASES: [string, string][] = [
  ["current laga", "SHOCK_HI_LATN_CURRENT"],
  ["current laga hai", "SHOCK_HI_LATN_CURRENT"],
  ["current lagta hai", "SHOCK_HI_LATN_CURRENT"],
  ["karant laga", "SHOCK_HI_LATN_CURRENT"],
  ["bijli ka jhatka laga", "SHOCK_HI_LATN_JHATKA"],
  ["bijli ka current laga", "SHOCK_HI_LATN_JHATKA"],
  ["current lagla", "SHOCK_MR_LATN_DHAKKA"],
  ["current laagla", "SHOCK_MR_LATN_DHAKKA"],
  ["electric shock", "SHOCK_EN_ELECTRIC"],
  ["got a shock", "SHOCK_EN_ELECTRIC"],
  ["करंट लगा", "SHOCK_HI_KARANT"],
  ["करंट लग गया", "SHOCK_HI_KARANT"],
  ["करंट लागला", "SHOCK_MR_KARANT"],
  ["विजेचा धक्का", "SHOCK_MR_DHAKKA"],
  ["बिजली का झटका लगा", "SHOCK_HI_JHATKA"],
  ["नल छूने पर करंट आता है", "SHOCK_HI_KARANT"],
  ["दीवार में करंट आ रहा है", "SHOCK_HI_LAG"],
  ["बिजली का करंट लगा बच्चे को", "SHOCK_HI_LAG"],
  ["करंट आ रहा है और झटका लगा", "SHOCK_HI_KARANT"],
  ["वायर को स्पर्श केला आणि करंट आला", "SHOCK_MR_KARANT"],
  ["current aa raha hai, jhatka laga", "SHOCK_HI_LATN_CURRENT"],
];

describe("D169 a bare current rule needs a shock context", () => {
  it.each(EVERYDAY_ELECTRICITY)("%j: no hit through a current rule, and no hit at all", (text) => {
    expect(viaCurrent(text)).toEqual([]);
    expect(detectSafetyWords(text)).toEqual([]);
  });

  it.each(SHOCK_PHRASES)("%j is still a strong hit (%s)", (text, ruleId) => {
    expect(detectSafetyWords(text).some((h) => h.rule === ruleId), text).toBe(true);
    const decision = decideClassification({ rawText: text, arms: [] });
    expect(decision.urgency).toBe("CRITICAL");
    expect(decision.safetyFlag).toBe(true);
  });

  it("no everyday sentence of the T10c group hits through a current rule any more (17 before, 0 after)", () => {
    const hits = LANGUAGE_FORMS.flatMap((form) => EVERYDAY_PHRASES[form]).filter((t) => viaCurrent(t).length > 0);
    expect(hits).toEqual([]);
  });

  it("a shock word anywhere in the same text is enough, a longer word that starts like one is not", () => {
    expect(detectSafetyWords("करंट आ रहा है तार को स्पर्श किया").length).toBeGreaterThan(0);
    expect(detectSafetyWords("करंट नहीं आ रहा लगातार").length).toBe(0);
    expect(detectSafetyWords("current aa raha hai, shock").length).toBeGreaterThan(0);
  });

  it("changes only the rules that have a bare current term, and only those terms", () => {
    const gated = SAFETY_RULES.filter((r) => r.needsShockContext !== undefined);
    expect(gated.map((r) => r.id).sort()).toEqual(["SHOCK_HI_KARANT", "SHOCK_HI_LAG", "SHOCK_HI_LATN_CURRENT", "SHOCK_HI_LATN_JHATKA", "SHOCK_MR_KARANT"]);
    for (const r of gated) for (const term of r.needsShockContext ?? []) expect(r.terms).toContain(term);
    expect(gated.flatMap((r) => r.needsShockContext ?? [])).toHaveLength(10);
  });

  it("every other rule is unchanged: the Latin electricity words with no shock word are no hit, and the other shock rules still hit alone", () => {
    for (const text of ["shock absorber of my car", "live wire near the gate", "the railing is giving current", "nanga taar latak raha hai", "उघडी वायर आहे", "वीज लागली"]) {
      expect(detectSafetyWords(text).length, text).toBeGreaterThan(0);
    }
  });
});
