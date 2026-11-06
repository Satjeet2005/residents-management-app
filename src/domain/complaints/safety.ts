import { type MatchKind, compileTerms, foldForMatching } from "./match";
import { normalizeComplaintText } from "./text";

export type SafetyCategory = "FIRE" | "GAS" | "LIFT_STUCK" | "SHOCK";
/** en: English; hi and mr: Hindi and Marathi in Devanagari; hi-Latn and mr-Latn: the same typed in Latin letters. */
export type SafetyLanguage = "en" | "hi" | "mr" | "hi-Latn" | "mr-Latn";
export type SafetyHit = { rule: string; category: SafetyCategory; language: SafetyLanguage; matched: string };

/**
 * WORD: the term must stand as a whole word (a letter, vowel sign or digit may not touch it on either side): "gas" does not hit "gasket".
 * STEM: only the start must be a word start; the word may go on: a Devanagari stem covers its inflections (अडकल covers अडकली, अडकलो, अडकले).
 */
type Kind = MatchKind;
type Rule = { id: string; category: SafetyCategory; language: SafetyLanguage; kind: Kind; terms: readonly string[]; except?: RegExp };

const rule = (id: string, category: SafetyCategory, language: SafetyLanguage, kind: Kind, terms: readonly string[], except?: RegExp): Rule => ({ id, category, language, kind, terms, except });

/**
 * THE RULES. HIGH RECALL over precision: a missed fire is worse than a false alarm, so a rule may also hit a sentence that is not an incident
 * ("fire exit", "gas bill", "no fire": there is NO negation handling, on purpose). The Hindi and Marathi lists are NOT yet verified by a native
 * speaker (docs/safety-words-review.md). A new category is not added here: the brief has these four.
 * In a Latin term a space means one or more spaces, hyphens or underscores; in a Devanagari term it means zero or more spaces (people write
 * "लिफ्टमध्ये" and "लिफ्ट मध्ये" alike).
 */
export const SAFETY_RULES: readonly Rule[] = [
  // FIRE
  rule("FIRE_EN_WORD", "FIRE", "en", "WORD", ["fire", "fires", "fyre"]),
  rule("FIRE_EN_PHRASE", "FIRE", "en", "WORD", ["on fire", "caught fire", "catching fire", "set fire", "set on fire", "fire broke out", "fire has broken out", "fire alarm"]),
  rule("FIRE_EN_SMOKE_BURN", "FIRE", "en", "STEM", ["smoke", "smoky", "burning", "burnt", "burning smell", "flames", "blaze"]),
  rule("FIRE_EN_HAZARD", "FIRE", "en", "WORD", ["short circuit", "short-circuit", "sparking", "sparks", "spark", "melting wire", "wire melted"]),
  rule("FIRE_HI_AAG", "FIRE", "hi", "STEM", ["आग"], /^(आगे|आगा|आगम|आगामी|आगंतुक|आगरा|आगाह|आगाज)/u),
  rule("FIRE_HI_AAG_LAGI", "FIRE", "hi", "STEM", ["आग लगी", "आग लग", "आग लगा", "आग लगने", "आगजनी", "आग भड़क"]),
  rule("FIRE_HI_DHUAN", "FIRE", "hi", "STEM", ["धुआं", "धुआ", "धुंआ", "धुएं", "धुँआ"]),
  rule("FIRE_HI_JAL", "FIRE", "hi", "STEM", ["जल रहा", "जल रही", "जल रहे", "जल गया", "जल गई", "जल गयी", "जलने", "जलता", "जलती", "जलकर"]),
  rule("FIRE_HI_AGNI", "FIRE", "hi", "STEM", ["अग्नि", "दमकल", "फायर", "फाइयर", "लपट"]),
  rule("FIRE_HI_SPARK", "FIRE", "hi", "STEM", ["चिंगारी", "शॉर्ट सर्किट", "शार्ट सर्किट", "स्पार्क", "तार जल"]),
  rule("FIRE_MR_AAGI", "FIRE", "mr", "STEM", ["आगी", "आगीचा", "आगीत", "आग लाग", "आगलाग"]),
  rule("FIRE_MR_DHUR", "FIRE", "mr", "STEM", ["धूर", "धुर"], /^धुरळ/u),
  rule("FIRE_MR_JALAT", "FIRE", "mr", "STEM", ["जळत", "जळाल", "जळून", "जळा", "होरपळ"]),
  rule("FIRE_MR_AGNI", "FIRE", "mr", "STEM", ["अग्निशमन", "अग्नी", "आगीचा बंब", "फायर"]),
  rule("FIRE_HI_LATN_AAG", "FIRE", "hi-Latn", "WORD", ["aag", "aaag", "aagg"]),
  rule("FIRE_HI_LATN_PHRASE", "FIRE", "hi-Latn", "WORD", ["aag lagi", "aag lag gayi", "aag lag gai", "aag laga", "aag laga hai", "aag lagne", "aag lag rahi"]),
  rule("FIRE_HI_LATN_DHUAN", "FIRE", "hi-Latn", "WORD", ["dhuan", "dhuaan", "dhuvan", "dhooan", "dhuwan"]),
  rule("FIRE_HI_LATN_JAL", "FIRE", "hi-Latn", "WORD", ["jal raha", "jal rahi", "jal gaya", "jal gayi", "jalne", "jalti", "jalta"]),
  rule("FIRE_MR_LATN_AAG", "FIRE", "mr-Latn", "WORD", ["aag lagli", "aag laagli", "aagi", "aagicha", "aagit", "aagila", "aag lagle"]),
  rule("FIRE_MR_LATN_DHUR", "FIRE", "mr-Latn", "WORD", ["dhur", "dhoor", "dhurachya", "dhurala", "jalat aahe", "jalat ahe"]),

  // GAS
  rule("GAS_EN_WORD", "GAS", "en", "WORD", ["gas", "gases", "gass"]),
  rule("GAS_EN_LEAK", "GAS", "en", "WORD", ["gas leak", "gas leakage", "leaking gas", "gas is leaking", "gas leaks", "gas leaking", "leak of gas", "gas escaping"]),
  rule("GAS_EN_SMELL", "GAS", "en", "WORD", ["gas smell", "smell of gas", "smells of gas", "smell gas", "smelling gas", "gas odour", "gas odor", "gas smells", "smells like gas"]),
  rule("GAS_EN_CYLINDER", "GAS", "en", "WORD", ["cylinder leak", "cylinder burst", "cylinder blast", "cylinder leaking", "lpg", "png", "gas cylinder", "gas pipeline"]),
  rule("GAS_EN_CO", "GAS", "en", "WORD", ["carbon monoxide", "suffocating", "suffocation", "cant breathe", "cannot breathe"]),
  rule("GAS_HI_WORD", "GAS", "hi", "STEM", ["गैस", "गेस", "गैस्"]),
  rule("GAS_HI_LEAK", "GAS", "hi", "STEM", ["गैस लीक", "गैस रिसाव", "गैस का रिसाव", "गैस निकल", "गैस रिस", "गैस का लीकेज", "गैस लिकेज"]),
  rule("GAS_HI_SMELL", "GAS", "hi", "STEM", ["गैस की बदबू", "गैस की गंध", "गैस की महक", "गैस की स्मेल", "गैस की बू", "गैस जैसी बदबू"]),
  rule("GAS_HI_CYLINDER", "GAS", "hi", "STEM", ["सिलेंडर", "सिलिंडर", "एलपीजी", "पीएनजी", "सिलेंडर फट"]),
  rule("GAS_MR_WORD", "GAS", "mr", "STEM", ["गॅस", "गॅसचा", "गॅसची", "गॅसचे", "गॅसला"]),
  rule("GAS_MR_LEAK", "GAS", "mr", "STEM", ["गॅस गळती", "गॅस लीक", "गॅस गळत", "गॅस गळ", "गॅसची गळती", "गॅस निघत"]),
  rule("GAS_MR_SMELL", "GAS", "mr", "STEM", ["गॅसचा वास", "गॅसचा दर्प", "गॅस वास", "गॅसचा दुर्गंध", "गॅसचा स्मेल"]),
  rule("GAS_MR_CYLINDER", "GAS", "mr", "STEM", ["सिलिंडर", "सिलेंडर", "गॅस सिलिंडर", "सिलिंडर फुट", "सिलिंडरचा स्फोट"]),
  rule("GAS_HI_LATN_SMELL", "GAS", "hi-Latn", "WORD", ["gas ka smell", "gas ki badbu", "gas ki gandh", "gas ki mahak", "gas ki boo", "gas ka badbu", "gas ki smell", "gas ki bu"]),
  rule("GAS_HI_LATN_LEAK", "GAS", "hi-Latn", "WORD", ["gas leak ho", "gas leak hai", "gas nikal raha", "gas ris raha", "gas ka leakage", "gas risaav", "gas rissav"]),
  rule("GAS_MR_LATN_VAS", "GAS", "mr-Latn", "WORD", ["gas cha vas", "gas cha vaas", "gas cha was", "gas cha dur", "gas cha smell"]),
  rule("GAS_MR_LATN_LEAK", "GAS", "mr-Latn", "WORD", ["gas leak zala", "gas leak zali", "gas galti zali", "gas leak jhala", "gas galti", "gas gal"]),

  // LIFT_STUCK
  rule("LIFT_EN_STUCK_IN", "LIFT_STUCK", "en", "WORD", ["stuck in the lift", "stuck in lift", "stuck inside the lift", "stuck inside lift", "stuck in the elevator", "stuck in elevator", "stuck in a lift", "stuck in an elevator"]),
  rule("LIFT_EN_TRAPPED", "LIFT_STUCK", "en", "WORD", ["trapped in the lift", "trapped in lift", "trapped in the elevator", "trapped inside lift", "trapped in a lift", "locked in the lift", "locked in lift", "people trapped", "trapped inside the lift"]),
  rule("LIFT_EN_LIFT_STUCK", "LIFT_STUCK", "en", "WORD", ["lift stuck", "lift is stuck", "lift got stuck", "lift has stuck", "elevator stuck", "elevator is stuck", "lift jammed", "elevator jammed", "lift is jammed", "lift stuck between floors"]),
  rule("LIFT_EN_BETWEEN", "LIFT_STUCK", "en", "WORD", ["between floors", "lift fell", "lift falling", "lift free fall", "lift dropped", "lift crashed", "lift stopped between"]),
  rule("LIFT_EN_NO_EXIT", "LIFT_STUCK", "en", "WORD", ["cant get out of the lift", "cannot get out of lift", "unable to get out of lift", "cant open lift door", "lift door not opening", "lift door wont open", "lift door is not opening", "cant get out of lift"]),
  rule("LIFT_EN_ALARM", "LIFT_STUCK", "en", "WORD", ["lift alarm", "lift emergency", "emergency in lift", "lift emergency button", "pressed the alarm in the lift"]),
  rule("LIFT_HI_PHANS", "LIFT_STUCK", "hi", "STEM", ["लिफ्ट में फंस", "लिफ्ट में फँस", "लिफ्ट के अंदर फंस", "लिफ्ट मे फंस", "लिफ्ट में फस"]),
  rule("LIFT_HI_ATAK", "LIFT_STUCK", "hi", "STEM", ["लिफ्ट अटक", "लिफ्ट में अटक", "लिफ्ट रुक गई", "लिफ्ट रुकी", "लिफ्ट बीच में", "लिफ्ट बीच मे"]),
  rule("LIFT_HI_BAND", "LIFT_STUCK", "hi", "STEM", ["लिफ्ट में बंद", "लिफ्ट में कैद", "लिफ्ट में फंसे", "लिफ्ट में फंसी", "लिफ्ट में फंसा", "लिफ्ट में लोग फंस"]),
  rule("LIFT_HI_GIR", "LIFT_STUCK", "hi", "STEM", ["लिफ्ट गिर", "लिफ्ट नीचे गिर", "लिफ्ट टूट कर गिर", "लिफ्ट गिरी"]),
  rule("LIFT_HI_DOOR", "LIFT_STUCK", "hi", "STEM", ["लिफ्ट का दरवाजा नहीं खुल", "लिफ्ट का दरवाज़ा नहीं खुल", "लिफ्ट का गेट नहीं खुल", "लिफ्ट का दरवाजा नही खुल"]),
  rule("LIFT_MR_ADAKAL", "LIFT_STUCK", "mr", "STEM", ["लिफ्टमध्ये अडकल", "लिफ्ट मध्ये अडकल", "लिफ्टमध्ये अडक", "लिफ्टमधे अडकल", "लिफ्ट मध्ये अडक"]),
  rule("LIFT_MR_BAND", "LIFT_STUCK", "mr", "STEM", ["लिफ्टमध्ये बंद", "लिफ्ट मध्ये बंद", "लिफ्टमध्ये कोंडल", "लिफ्टमध्ये अडकून", "लिफ्टमध्ये लोक अडक"]),
  rule("LIFT_MR_THAMBLI", "LIFT_STUCK", "mr", "STEM", ["लिफ्ट मध्येच थांबल", "लिफ्ट मध्येच बंद", "लिफ्ट मधेच", "लिफ्टमध्येच थांबल", "लिफ्ट मध्येच अडक"]),
  rule("LIFT_MR_PADLI", "LIFT_STUCK", "mr", "STEM", ["लिफ्ट कोसळ", "लिफ्ट पडली", "लिफ्ट खाली पडल", "लिफ्ट वरून पडल"]),
  rule("LIFT_MR_DAR", "LIFT_STUCK", "mr", "STEM", ["लिफ्टचा दरवाजा उघडत नाही", "लिफ्टचे दार उघडत नाही", "लिफ्टचा दरवाजा उघडत", "लिफ्टचे दार उघडत"]),
  rule("LIFT_HI_LATN_ATAK", "LIFT_STUCK", "hi-Latn", "WORD", ["lift atak gayi", "lift atak gaya", "lift atki", "lift atak", "lift ruk gayi", "lift beech mein", "lift beech me ruk"]),
  rule("LIFT_HI_LATN_PHANS", "LIFT_STUCK", "hi-Latn", "WORD", ["lift mein phans", "lift me phans", "lift mein fans", "lift me fas", "lift mein phansa", "lift mein phase", "lift ke andar phans"]),
  rule("LIFT_HI_LATN_BAND", "LIFT_STUCK", "hi-Latn", "WORD", ["lift mein band", "lift me band", "lift ke andar band", "lift ke andar fas", "lift gir gayi", "lift mein log phanse"]),
  rule("LIFT_MR_LATN_ADAKLO", "LIFT_STUCK", "mr-Latn", "STEM", ["lift madhe adakl", "lift madhye adakl", "lift madhe adkal", "lift madhe adakun", "liftmadhe adakl", "lift madhe adak"]),
  rule("LIFT_MR_LATN_THAMBLI", "LIFT_STUCK", "mr-Latn", "STEM", ["lift madhech thambl", "lift madhech band", "lift thambli", "lift madhech", "lift padli"]),

  // SHOCK
  rule("SHOCK_EN_ELECTRIC", "SHOCK", "en", "STEM", ["electric shock", "electrical shock", "got a shock", "got shock", "gave me a shock", "electrocut", "electrocution", "shock from"]),
  rule("SHOCK_EN_WORD", "SHOCK", "en", "WORD", ["shock", "shocks"]),
  rule("SHOCK_EN_CURRENT", "SHOCK", "en", "WORD", ["live wire", "live wires", "exposed wire", "exposed wires", "naked wire", "current passing", "wire sparking", "open wire"]),
  rule("SHOCK_EN_TOUCH", "SHOCK", "en", "WORD", ["get shock", "getting shock", "giving shock", "gives shock", "giving current", "gives current", "wall is giving current", "body is getting current"]),
  rule("SHOCK_EN_EARTH", "SHOCK", "en", "WORD", ["no earthing", "earthing problem", "earth leakage", "current in the tap", "current in the wall", "current in the railing"]),
  rule("SHOCK_HI_KARANT", "SHOCK", "hi", "STEM", ["करंट", "करेंट", "करंट लगा", "करंट लग", "करेंट लग", "करंट आ रहा"]),
  rule("SHOCK_HI_JHATKA", "SHOCK", "hi", "STEM", ["बिजली का झटका", "बिजली के झटके", "बिजली झटका", "बिजली का झटका लगा", "बिजली का शॉक"]),
  rule("SHOCK_HI_SHOCK", "SHOCK", "hi", "STEM", ["शॉक", "शाक लग", "शॉक लगा", "इलेक्ट्रिक शॉक", "शौक लगा"]),
  rule("SHOCK_HI_TAR", "SHOCK", "hi", "STEM", ["नंगा तार", "खुला तार", "टूटा तार", "तार टूट", "बिजली का नंगा", "खुले तार"]),
  rule("SHOCK_HI_LAG", "SHOCK", "hi", "STEM", ["बिजली लग", "बिजली का करंट", "करंट आ", "दीवार में करंट", "नल में करंट", "पानी में करंट"]),
  rule("SHOCK_MR_DHAKKA", "SHOCK", "mr", "STEM", ["विजेचा धक्का", "विजेचा झटका", "विजेचा शॉक", "वीज धक्का", "वीजेचा धक्का", "विजेचे धक्के"]),
  rule("SHOCK_MR_KARANT", "SHOCK", "mr", "STEM", ["करंट", "करंट लागला", "करंट लागत", "करंट आला", "करेंट लागला"]),
  rule("SHOCK_MR_SHOCK", "SHOCK", "mr", "STEM", ["शॉक", "शॉक लागला", "शॉक बसला", "शॉक बसत", "शॉक लागत"]),
  rule("SHOCK_MR_BASLA", "SHOCK", "mr", "STEM", ["वीज लागली", "वीज लागल", "विजेचा झटका बसला", "धक्का बसला विजे"]),
  rule("SHOCK_MR_WIRE", "SHOCK", "mr", "STEM", ["उघडी वायर", "उघड्या वायर", "वायर तुटली", "तार तुटली", "उघडी तार", "उघडा तार"]),
  rule("SHOCK_HI_LATN_SHOCK", "SHOCK", "hi-Latn", "WORD", ["shock laga", "shock lag", "shock lagi", "shock lagta", "shock mara", "shock lag gaya"]),
  rule("SHOCK_HI_LATN_CURRENT", "SHOCK", "hi-Latn", "WORD", ["current laga", "current lag", "current lagta", "current aa raha", "current aata", "karant laga", "karant lag", "karent laga", "current maar"]),
  rule("SHOCK_HI_LATN_JHATKA", "SHOCK", "hi-Latn", "WORD", ["bijli ka jhatka", "bijli ka jhatke", "bijli ka jhatka laga", "bijli lag", "bijli lag gayi", "bijli ka current"]),
  rule("SHOCK_HI_LATN_TAAR", "SHOCK", "hi-Latn", "WORD", ["nanga taar", "nange taar", "khula taar", "khule taar", "taar toot", "taar tuta"]),
  rule("SHOCK_MR_LATN_DHAKKA", "SHOCK", "mr-Latn", "WORD", ["vijecha dhakka", "viji cha dhakka", "vijecha shock", "current laagla", "current lagla", "shock laagla", "shock baisla", "karant laagla"]),
  rule("SHOCK_MR_LATN_WIRE", "SHOCK", "mr-Latn", "WORD", ["ughadi tar", "ughadi wire", "wire tutli", "tar tutli", "ughdi wire"]),
];

const LETTER_OR_MARK_OR_DIGIT = /[\p{L}\p{M}\p{N}]/u;

type Compiled = Rule & { pattern: RegExp };

const COMPILED: readonly Compiled[] = SAFETY_RULES.map((r) => ({
  ...r,
  pattern: compileTerms(r.terms, r.kind),
}));

/**
 * Safety words in a complaint, as one hit per rule that matches (never more). The text is normalised first (NFC, zero-width characters out,
 * Devanagari digits to ASCII, 2,000 characters), lower-cased for Latin letters and folded for Devanagari, and the ORIGINAL words are what is
 * read: a translation is never used. `matched` is the matched text after that folding.
 *
 * It never throws and has no state. It has NO negation handling, so "no fire" and "fire exit" hit: for a safety rule a false alarm is cheaper than
 * a missed fire. Known accepted false positives are listed in tests/domain/complaints/safety.test.ts and docs/complaint-classification.md.
 */
export function detectSafetyWords(raw: string): SafetyHit[] {
  const text = foldForMatching(normalizeComplaintText(raw));
  if (text === "") return [];
  const hits: SafetyHit[] = [];
  for (const compiled of COMPILED) {
    compiled.pattern.lastIndex = 0;
    for (const match of text.matchAll(compiled.pattern)) {
      const start = match.index ?? 0;
      if (compiled.except !== undefined) {
        let end = start + match[0].length;
        while (end < text.length && LETTER_OR_MARK_OR_DIGIT.test(text[end])) end += 1;
        if (compiled.except.test(text.slice(start, end))) continue;
      }
      hits.push({ rule: compiled.id, category: compiled.category, language: compiled.language, matched: match[0] });
      break;
    }
  }
  return hits;
}

/** True when any rule hits. */
export const hasSafetyWord = (raw: string): boolean => detectSafetyWords(raw).length > 0;
