import { type CategoryCode, type Urgency } from "./taxonomy";
import { type MatchKind, compileTerms, foldForMatching } from "./match";
import { normalizeComplaintText } from "./text";

export type KeywordResult = { category: CategoryCode | null; urgency: Extract<Urgency, "HIGH" | "NORMAL" | "LOW">; matched: string[] };

type Group = { terms: readonly string[]; kind: MatchKind };
/** English and Hindi, Marathi and Hinglish words by category. Latin terms are whole words, Devanagari terms are stems (they cover inflections). */
const CATEGORY_TERMS: Record<Exclude<CategoryCode, "OTHER">, Group[]> = {
  PLUMBING: [
    { kind: "WORD", terms: ["leak", "leaks", "leaking", "leakage", "tap", "taps", "pipe", "pipes", "water", "drain", "drainage", "sewage", "flush", "toilet", "overflow", "overflowing", "seepage", "tank", "plumber", "dampness", "no water", "naal", "nal", "paani", "pani", "tanki", "naali", "tapak", "tapakna", "risaav", "tonti", "gatar"] },
    { kind: "STEM", terms: ["पानी", "नल", "लीक", "रिसाव", "पाइप", "टंकी", "नाली", "सीवेज", "टपक", "पाणी", "नळ", "गळती", "गळत", "पाईप", "टाकी", "गटार", "तोटी"] },
  ],
  ELECTRICAL: [
    { kind: "WORD", terms: ["light", "lights", "power", "electricity", "electric", "electrical", "switch", "wire", "wires", "wiring", "bulb", "fan", "mcb", "meter", "socket", "plug", "inverter", "voltage", "bijli", "batti", "taar", "pankha", "vij", "tubelight"] },
    { kind: "STEM", terms: ["बिजली", "लाइट", "लाईट", "बत्ती", "स्विच", "तार", "पंखा", "मीटर", "बल्ब", "सॉकेट", "वीज", "दिवा", "वायर", "पंखे"] },
  ],
  LIFT: [
    { kind: "WORD", terms: ["lift", "lifts", "elevator", "elevators"] },
    { kind: "STEM", terms: ["लिफ्ट"] },
  ],
  HOUSEKEEPING: [
    { kind: "WORD", terms: ["garbage", "trash", "rubbish", "waste", "cleaning", "clean", "dirty", "dust", "dustbin", "sweeping", "sweeper", "housekeeping", "mop", "litter", "cleanliness", "kachra", "safai", "ganda", "gandagi", "kooda", "kuda", "jhadu", "ghan"] },
    { kind: "STEM", terms: ["कचरा", "सफाई", "गंदगी", "गंदा", "झाड़ू", "झाडू", "कूड़ा", "कूड़ेदान", "डस्टबिन", "स्वच्छता", "घाण", "केर"] },
  ],
};

/** General words that fit no other category. OTHER is chosen only when nothing above matched and one of these did. */
const OTHER_TERMS: Group[] = [
  { kind: "WORD", terms: ["noise", "noisy", "parking", "security", "guard", "neighbour", "neighbor", "neighbours", "dog", "dogs", "stray", "pest", "pests", "cockroach", "mosquito", "clubhouse", "garden", "gate", "visitor", "visitors", "shor", "kutta", "kutte"] },
  { kind: "STEM", terms: ["शोर", "पार्किंग", "सुरक्षा", "कुत्ता", "कुत्ते", "आवाज", "कुत्रा", "कुत्रे", "गोंधळ", "शेजारी", "पड़ोसी"] },
];

const HIGH_TERMS: Group[] = [
  { kind: "WORD", terms: ["urgent", "urgently", "immediately", "immediate", "asap", "emergency", "right now", "at once", "turant", "jaldi", "foran", "fauran", "lagech", "tatkal", "tatkaal", "tabadtob", "tatadine"] },
  { kind: "STEM", terms: ["तुरंत", "तुरन्त", "फौरन", "जल्दी", "तत्काल", "लगेच", "ताबडतोब", "तातडीने", "तात्काळ", "त्वरित"] },
];

/** Words that say there is no hurry. They are taken out of the text before the urgent words are looked for, so "not urgent" is not "urgent". */
const LOW_TERMS: Group[] = [
  { kind: "WORD", terms: ["whenever", "no hurry", "no rush", "not urgent", "not in a hurry", "when you get time", "when possible", "at your convenience", "anytime", "any time", "no emergency", "jaldi nahi", "urgent nahi", "koi jaldi nahi", "kabhi bhi", "kadhihi", "ghai nahi"] },
  { kind: "STEM", terms: ["जल्दी नहीं", "जल्दी नही", "कभी भी", "कोई जल्दी नहीं", "कधीही", "घाई नाही", "तातडी नाही", "अर्जंट नाही"] },
];

const compile = (groups: Group[]) => groups.map((g) => ({ pattern: compileTerms(g.terms, g.kind) }));
const CATEGORY_PATTERNS = (Object.keys(CATEGORY_TERMS) as (keyof typeof CATEGORY_TERMS)[]).map((category) => ({ category, patterns: compile(CATEGORY_TERMS[category]) }));
const OTHER_PATTERNS = compile(OTHER_TERMS);
const HIGH_PATTERNS = compile(HIGH_TERMS);
const LOW_PATTERNS = compile(LOW_TERMS);

/** The distinct matches of the patterns in a text, in the order found. */
function matches(text: string, patterns: { pattern: RegExp }[]): string[] {
  const found: string[] = [];
  for (const { pattern } of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) if (!found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/**
 * A keyword reading of a complaint, for when no model result is usable (D9, D73). Pure, total and deterministic; it knows nothing about safety
 * (that is `detectSafetyWords`).
 *
 * CATEGORY: each of PLUMBING, ELECTRICAL, LIFT and HOUSEKEEPING scores the number of different keywords of it found; the highest score wins. A TIE
 * for the highest score gives null (a person triages it): "the lift light is out" mentions a lift and a light. When none of the four matches,
 * OTHER is the answer only if a general word (noise, parking, dogs ...) matched; otherwise null.
 * URGENCY: words that say there is no hurry are taken out first; then an urgent word (urgent, immediately, asap, तुरंत, लगेच ...) gives HIGH, else
 * the no-hurry words give LOW, else NORMAL. HIGH wins over LOW when both stand ("whenever, but urgent").
 * LIMITS: keywords miss spelling variants and sentences without a keyword, and a keyword can be about something else ("light" as in light
 * weight). The Hindi and Marathi lists are not yet verified by a native speaker.
 */
export function classifyByKeywords(text: string): KeywordResult {
  const folded = foldForMatching(normalizeComplaintText(text));
  if (folded === "") return { category: null, urgency: "NORMAL", matched: [] };

  const scored = CATEGORY_PATTERNS.map(({ category, patterns }) => ({ category, found: matches(folded, patterns) })).filter((entry) => entry.found.length > 0);
  const best = scored.reduce((max, entry) => Math.max(max, entry.found.length), 0);
  const leaders = scored.filter((entry) => entry.found.length === best);
  const other = scored.length === 0 ? matches(folded, OTHER_PATTERNS) : [];
  const category: CategoryCode | null = leaders.length === 1 ? leaders[0].category : scored.length === 0 && other.length > 0 ? "OTHER" : null;

  let remaining = folded;
  const low = matches(folded, LOW_PATTERNS);
  for (const pattern of LOW_PATTERNS) {
    pattern.pattern.lastIndex = 0;
    remaining = remaining.replace(pattern.pattern, " ");
  }
  const high = matches(remaining, HIGH_PATTERNS);
  const urgency = high.length > 0 ? "HIGH" : low.length > 0 ? "LOW" : "NORMAL";

  return { category, urgency, matched: [...scored.flatMap((entry) => entry.found), ...other, ...high, ...low] };
}
