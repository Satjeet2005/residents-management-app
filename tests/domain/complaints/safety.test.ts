import { describe, expect, it } from "vitest";
import { SAFETY_RULES, detectSafetyWords, hasSafetyWord, type SafetyCategory, type SafetyLanguage } from "@/domain/complaints/safety";
import { createPrng } from "@/domain/seed/prng";
import { MV_ACCEPTED_FALSE_POSITIVES, MV_NEGATIVES, MV_POSITIVES } from "./medical-violence-cases";

/** [text, the rule that must hit]. Every rule of the table appears at least once. */
const POSITIVES: [string, string][] = [
  ...MV_POSITIVES,
  // FIRE: English
  ["There is fire in the parking lot", "FIRE_EN_WORD"],
  ["FIRE!!!", "FIRE_EN_WORD"],
  ["Fire in tower 5", "FIRE_EN_WORD"],
  ["the transformer caught fire", "FIRE_EN_PHRASE"],
  ["my kitchen is on fire", "FIRE_EN_PHRASE"],
  ["Heavy smoke coming from the basement", "FIRE_EN_SMOKE_BURN"],
  ["something is burning on the 3rd floor", "FIRE_EN_SMOKE_BURN"],
  ["short circuit in the meter room", "FIRE_EN_HAZARD"],
  ["the switch board is sparking", "FIRE_EN_HAZARD"],
  // FIRE: Hindi, Marathi, romanised
  ["बिल्डिंग में आग है", "FIRE_HI_AAG"],
  ["आग", "FIRE_HI_AAG"],
  ["टावर 5 में आग लगी है", "FIRE_HI_AAG_LAGI"],
  ["बेसमेंट से धुआं निकल रहा है", "FIRE_HI_DHUAN"],
  ["बेसमेंट से धुँआ निकल रहा है", "FIRE_HI_DHUAN"],
  ["तार जल रहा है", "FIRE_HI_JAL"],
  ["दमकल को बुलाओ", "FIRE_HI_AGNI"],
  ["मीटर में चिंगारी निकल रही है", "FIRE_HI_SPARK"],
  ["इमारतीला आगी लागली", "FIRE_MR_AAGI"],
  ["आगीचा धूर दिसतोय", "FIRE_MR_AAGI"],
  ["तळघरातून धूर येत आहे", "FIRE_MR_DHUR"],
  ["वायर जळत आहे", "FIRE_MR_JALAT"],
  ["अग्निशमन दलाला बोलवा", "FIRE_MR_AGNI"],
  ["aag", "FIRE_HI_LATN_AAG"],
  ["Aag!", "FIRE_HI_LATN_AAG"],
  ["tower 2 mein aag lagi hai", "FIRE_HI_LATN_PHRASE"],
  ["basement se dhuan nikal raha hai", "FIRE_HI_LATN_DHUAN"],
  ["wire jal raha hai", "FIRE_HI_LATN_JAL"],
  ["ghar mein aag lagli aahe", "FIRE_MR_LATN_AAG"],
  ["dhur yet aahe", "FIRE_MR_LATN_DHUR"],
  // GAS
  ["Please check the gas", "GAS_EN_WORD"],
  ["There is a gas leak in the kitchen", "GAS_EN_LEAK"],
  ["gas leakage near the meter", "GAS_EN_LEAK"],
  ["strong smell of gas on the 4th floor", "GAS_EN_SMELL"],
  ["I can smell gas", "GAS_EN_SMELL"],
  ["the cylinder leak is dangerous", "GAS_EN_CYLINDER"],
  ["LPG smell in the corridor", "GAS_EN_CYLINDER"],
  ["carbon monoxide alarm is beeping", "GAS_EN_CO"],
  ["गैस", "GAS_HI_WORD"],
  ["गैस लीक हो रही है", "GAS_HI_LEAK"],
  ["गैस का रिसाव हो रहा है", "GAS_HI_LEAK"],
  ["गैस की बदबू आ रही है", "GAS_HI_SMELL"],
  ["सिलेंडर फट गया", "GAS_HI_CYLINDER"],
  ["गॅसचा त्रास आहे", "GAS_MR_WORD"],
  ["गॅस गळती होत आहे", "GAS_MR_LEAK"],
  ["गॅसचा वास येतो", "GAS_MR_SMELL"],
  ["सिलिंडरचा स्फोट झाला", "GAS_MR_CYLINDER"],
  ["gas ka smell aa raha hai", "GAS_HI_LATN_SMELL"],
  ["gas ki badbu hai", "GAS_HI_LATN_SMELL"],
  ["gas leak ho raha hai", "GAS_HI_LATN_LEAK"],
  ["gas cha vas yeto", "GAS_MR_LATN_VAS"],
  ["gas leak zala", "GAS_MR_LATN_LEAK"],
  // LIFT_STUCK
  ["my mother is stuck in the lift", "LIFT_EN_STUCK_IN"],
  ["we are stuck in the elevator", "LIFT_EN_STUCK_IN"],
  ["two children trapped in the lift", "LIFT_EN_TRAPPED"],
  ["people trapped", "LIFT_EN_TRAPPED"],
  ["the lift is stuck on the 7th floor", "LIFT_EN_LIFT_STUCK"],
  ["Lift stuck!", "LIFT_EN_LIFT_STUCK"],
  ["the lift stopped between floors", "LIFT_EN_BETWEEN"],
  ["lift fell two floors", "LIFT_EN_BETWEEN"],
  ["we can't open lift door", "LIFT_EN_NO_EXIT"],
  ["lift door won't open", "LIFT_EN_NO_EXIT"],
  ["the lift alarm is ringing", "LIFT_EN_ALARM"],
  ["मैं लिफ्ट में फंस गया हूँ", "LIFT_HI_PHANS"],
  ["हम लिफ्ट में फँस गए", "LIFT_HI_PHANS"],
  ["लिफ्ट अटक गई", "LIFT_HI_ATAK"],
  ["बच्चे लिफ्ट में बंद हैं", "LIFT_HI_BAND"],
  ["लिफ्ट नीचे गिर गई", "LIFT_HI_GIR"],
  ["लिफ्ट का दरवाजा नहीं खुल रहा", "LIFT_HI_DOOR"],
  ["आम्ही लिफ्टमध्ये अडकलो आहोत", "LIFT_MR_ADAKAL"],
  ["ती लिफ्ट मध्ये अडकली", "LIFT_MR_ADAKAL"],
  ["ते लिफ्टमध्ये अडकले", "LIFT_MR_ADAKAL"],
  ["मुलगा लिफ्टमध्ये बंद आहे", "LIFT_MR_BAND"],
  ["लिफ्ट मध्येच थांबली", "LIFT_MR_THAMBLI"],
  ["लिफ्ट पडली", "LIFT_MR_PADLI"],
  ["लिफ्टचा दरवाजा उघडत नाही", "LIFT_MR_DAR"],
  ["lift atak gayi hai", "LIFT_HI_LATN_ATAK"],
  ["hum lift mein phans gaye", "LIFT_HI_LATN_PHANS"],
  ["bachche lift mein band hain", "LIFT_HI_LATN_BAND"],
  ["mi lift madhe adaklo", "LIFT_MR_LATN_ADAKLO"],
  ["lift madhech thambli", "LIFT_MR_LATN_THAMBLI"],
  // SHOCK
  ["she got an electric shock from the switch", "SHOCK_EN_ELECTRIC"],
  ["the worker was electrocuted", "SHOCK_EN_ELECTRIC"],
  ["shock", "SHOCK_EN_WORD"],
  ["a live wire is hanging near the gate", "SHOCK_EN_CURRENT"],
  ["the railing is giving current", "SHOCK_EN_TOUCH"],
  ["there is an earthing problem in the bathroom", "SHOCK_EN_EARTH"],
  ["नल छूने पर करंट आता है", "SHOCK_HI_KARANT"],
  ["बिजली का झटका लगा", "SHOCK_HI_JHATKA"],
  ["बच्चे को शॉक लगा", "SHOCK_HI_SHOCK"],
  ["खुला तार लटक रहा है", "SHOCK_HI_TAR"],
  ["बिजली लग गई", "SHOCK_HI_LAG"],
  ["विजेचा धक्का बसला", "SHOCK_MR_DHAKKA"],
  ["करंट लागला", "SHOCK_MR_KARANT"],
  ["शॉक बसला", "SHOCK_MR_SHOCK"],
  ["वीज लागली", "SHOCK_MR_BASLA"],
  ["उघडी वायर आहे", "SHOCK_MR_WIRE"],
  ["mujhe shock laga", "SHOCK_HI_LATN_SHOCK"],
  ["current laga hai", "SHOCK_HI_LATN_CURRENT"],
  ["bijli ka jhatka laga", "SHOCK_HI_LATN_JHATKA"],
  ["nanga taar latak raha hai", "SHOCK_HI_LATN_TAAR"],
  ["vijecha dhakka basla", "SHOCK_MR_LATN_DHAKKA"],
  ["ughadi wire aahe", "SHOCK_MR_LATN_WIRE"],
];

/** Texts that must NOT hit anything. */
const NEGATIVES: string[] = [
  ...MV_NEGATIVES,
  "the gasket of the tap is broken",
  "gastric problem since morning",
  "fireplace in the clubhouse",
  "the firewall of the office",
  "fireworks tonight are too loud",
  "gasoline price",
  "he gasped",
  "trip to Las Vegas",
  "the guard was fired",
  "bonfire party in the garden",
  "campfire next week",
  "my car had a backfire",
  "the lift is not working",
  "the lift is working fine",
  "please service the lift",
  "lift is very slow today",
  "the lift is crowded in the morning",
  "tap is leaking in the bathroom",
  "water leakage in the bedroom",
  "light is not working in the corridor",
  "electricity bill is high",
  "current bill not received",
  "an electrician is needed",
  "the switch is loose",
  "garbage not collected for three days",
  "parking problem near gate",
  "noise from the flat above",
  "stray dogs near the park",
  "I was shocked at the bill",
  "shockingly bad service",
  "Hello",
  "",
  "🙂🙂🙂",
  "12345",
  "please call me back",
  "आगे बढ़ो",
  "आगामी बैठक रविवार को है",
  "भागना मत",
  "लिफ्ट बंद है",
  "लिफ्ट ठीक करो",
  "लिफ्ट बहुत धीमी है",
  "बिजली का बिल ज्यादा है",
  "बिजली गई है",
  "पानी नहीं आ रहा",
  "नल टपक रहा है",
  "जल विभाग को बताओ",
  "झटका",
  "धुरळा उडतो",
  "कचरा नहीं उठा",
  "लिफ्ट बंद आहे",
  "पाणी येत नाही",
  "आगामी सभा",
  "वीज गेली आहे",
  "कचरा उचलला नाही",
  "lift band hai",
  "paani nahi aa raha",
  "bijli gayi hai",
  "kachra nahi uthaya",
  "current bill zyada aaya",
  "bijli lagao",
];

/** Sentences that DO hit although they are not incidents: the price of high recall (no negation handling), accepted on purpose. */
const ACCEPTED_FALSE_POSITIVES: [string, string][] = [
  ...MV_ACCEPTED_FALSE_POSITIVES,
  ["there is no fire, just checking", "FIRE_EN_WORD"],
  ["the fire exit is blocked by bikes", "FIRE_EN_WORD"],
  ["the fire extinguisher has expired", "FIRE_EN_WORD"],
  ["gas stove burner is not working", "GAS_EN_WORD"],
  ["the gas bill is too high", "GAS_EN_WORD"],
  ["cooking gas delivery is late", "GAS_EN_WORD"],
  ["shock absorber of my car", "SHOCK_EN_WORD"],
  ["smoke detector battery is low", "FIRE_EN_SMOKE_BURN"],
  ["cigarette smoke in the lobby", "FIRE_EN_SMOKE_BURN"],
  ["burnt food smell in the corridor", "FIRE_EN_SMOKE_BURN"],
  ["कोई आग नहीं लगी", "FIRE_HI_AAG"],
  ["करंट बिल ज्यादा आया है", "SHOCK_HI_KARANT"],
  ["गैस बिल नहीं मिला", "GAS_HI_WORD"],
];

const CATEGORIES: SafetyCategory[] = ["FIRE", "GAS", "LIFT_STUCK", "SHOCK", "MEDICAL_VIOLENCE"];
const ID_PREFIX: Record<SafetyCategory, string> = { FIRE: "FIRE_", GAS: "GAS_", LIFT_STUCK: "LIFT_", SHOCK: "SHOCK_", MEDICAL_VIOLENCE: "MV_" };
const ids = new Set(SAFETY_RULES.map((r) => r.id));
const rule = (id: string) => SAFETY_RULES.find((r) => r.id === id)!;

describe("CP2 the rule table", () => {
  it("has unique ids and at least 8 rules for each of the five categories, and only those categories", () => {
    expect(ids.size).toBe(SAFETY_RULES.length);
    for (const category of CATEGORIES) expect(SAFETY_RULES.filter((r) => r.category === category).length, category).toBeGreaterThanOrEqual(8);
    expect(new Set(SAFETY_RULES.map((r) => r.category))).toEqual(new Set(CATEGORIES));
  });

  it("covers all five language families in every category, with the id naming its language", () => {
    for (const category of CATEGORIES) {
      expect(new Set(SAFETY_RULES.filter((r) => r.category === category).map((r) => r.language)), category).toEqual(new Set(["en", "hi", "mr", "hi-Latn", "mr-Latn"]));
    }
    for (const r of SAFETY_RULES) expect(r.id.startsWith(ID_PREFIX[r.category]), r.id).toBe(true);
  });

  it("every Devanagari rule has Devanagari terms and every Latin rule has none", () => {
    for (const r of SAFETY_RULES) {
      const devanagari = r.terms.map((t) => /[ऀ-ॿ]/.test(t));
      const expected = r.language === "hi" || r.language === "mr";
      expect(devanagari.every((d) => d === expected), r.id).toBe(true);
    }
  });
});

describe("CP2 positives", () => {
  it("there are at least 70 positive cases, in the five categories and the five language families", () => {
    expect(POSITIVES.length).toBeGreaterThanOrEqual(70);
    const used = POSITIVES.map(([, id]) => rule(id));
    expect(new Set(used.map((r) => r.category)).size).toBe(5);
    expect(new Set(used.map((r) => r.language)).size).toBe(5);
  });

  it.each(POSITIVES)("%j hits %s, with that rule's category and language", (text, id) => {
    const hit = detectSafetyWords(text).find((h) => h.rule === id);
    expect(hit, JSON.stringify(detectSafetyWords(text))).toBeDefined();
    expect(hit?.category).toBe(rule(id).category);
    expect(hit?.language).toBe(rule(id).language as SafetyLanguage);
    expect(hit?.matched.length).toBeGreaterThan(0);
  });

  it("every rule in the table is exercised by at least one positive case", () => {
    const exercised = new Set(POSITIVES.map(([, id]) => id));
    expect([...ids].filter((id) => !exercised.has(id))).toEqual([]);
    expect([...exercised].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("is case-insensitive for Latin letters and reads text that is not normalised", () => {
    expect(hasSafetyWord("FIRE")).toBe(true);
    expect(hasSafetyWord("FiRe")).toBe(true);
    expect(hasSafetyWord("fi​re")).toBe(true);
    expect(hasSafetyWord("  gas   leak  ")).toBe(true);
    expect(hasSafetyWord("gas-leak")).toBe(true);
    expect(hasSafetyWord("आ‍ग")).toBe(true);
    expect(hasSafetyWord("लिफ्ट में फँस गया")).toBe(true);
    expect(hasSafetyWord("लिफ़्ट में फंस गया")).toBe(true);
  });

  it("gives one hit per rule, and several rules can hit one sentence", () => {
    const hits = detectSafetyWords("fire and gas leak and shock");
    const rules = hits.map((h) => h.rule);
    expect(new Set(rules).size).toBe(rules.length);
    expect(new Set(hits.map((h) => h.category))).toEqual(new Set(["FIRE", "GAS", "SHOCK"]));
  });

  it("a hit deep in a long text (past 2,000 characters) is not seen: only the first 2,000 characters are read", () => {
    expect(hasSafetyWord(`${"a ".repeat(900)}fire`)).toBe(true);
    expect(hasSafetyWord(`${"a ".repeat(1500)}fire`)).toBe(false);
  });
});

describe("CP2 negatives", () => {
  it("there are at least 40 negative cases", () => {
    expect(NEGATIVES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(NEGATIVES)("%j hits nothing", (text) => {
    expect(detectSafetyWords(text)).toEqual([]);
  });
});

describe("CP2 accepted false positives (high recall, no negation)", () => {
  it.each(ACCEPTED_FALSE_POSITIVES)("%j still hits %s, and this is documented", (text, id) => {
    expect(detectSafetyWords(text).some((h) => h.rule === id)).toBe(true);
  });
});

describe("CP2 robustness", () => {
  const ALPHABET = [
    ..."abcdefghijklmnopqrstuvwxyz ABCXYZ0123456789 .,;:!?-_/'\"()[]",
    ..."आगलफंसिटमेंधुआगैसकरंटझ्टकाशॉक अडकल",
    ..."़ँंाे०९",
    ..."🔥💥😀👍🏽",
    ..."\u0000\u0001\u0007\u0008\u001B\u007F​‍﻿  ",
    ..."مرحبا שלום",
    "\uD800",
    "\uDC00",
    "‮",
  ];

  it("never throws on 2,000 seeded random strings (emoji, control characters, right-to-left text, lone surrogates), and gives the same answer twice", () => {
    const rng = createPrng(20261107);
    for (let i = 0; i < 2000; i++) {
      const length = i % 100 === 0 ? 5000 : rng.int(0, 300);
      let text = "";
      for (let j = 0; j < length; j++) text += rng.pick(ALPHABET);
      const first = detectSafetyWords(text);
      expect(Array.isArray(first)).toBe(true);
      expect(detectSafetyWords(text)).toEqual(first);
      for (const hit of first) expect(ids.has(hit.rule)).toBe(true);
    }
  });

  it.each([
    ["empty", ""],
    ["a lone emoji", "🔥"],
    ["control characters", "\u0000\u0001\u001B"],
    ["5,000 characters", "x".repeat(5000)],
    ["5,000 Devanagari characters", "आ".repeat(5000)],
    ["right-to-left", "مرحبا بالعالم"],
    ["a lone surrogate", "\uD800 fire"],
  ])("does not throw on %s", (_label, text) => {
    expect(() => detectSafetyWords(text)).not.toThrow();
  });

  it("a lone surrogate beside a safety word does not hide it", () => {
    expect(hasSafetyWord("\uD800 fire")).toBe(true);
  });

  it("is fast: 200 texts of 2,000 characters in well under a second", () => {
    const text = "लिफ्ट में फंस gas leak ".repeat(120);
    const started = performance.now();
    for (let i = 0; i < 200; i++) detectSafetyWords(text);
    expect(performance.now() - started).toBeLessThan(2500);
  });

  it("non-string input gives no hits instead of throwing", () => {
    expect(detectSafetyWords(undefined as unknown as string)).toEqual([]);
    expect(detectSafetyWords(null as unknown as string)).toEqual([]);
  });
});
