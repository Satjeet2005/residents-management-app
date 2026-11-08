import { type MatchKind, compileTerms, foldForMatching } from "./match";
import { type SafetyVia, normalizeForSafety } from "./safety-normalize";
import { normalizeComplaintText } from "./text";

export type SafetyCategory = "FIRE" | "GAS" | "LIFT_STUCK" | "SHOCK" | "MEDICAL_VIOLENCE";
/** en: English; hi and mr: Hindi and Marathi in Devanagari; hi-Latn and mr-Latn: the same typed in Latin letters. */
export type SafetyLanguage = "en" | "hi" | "mr" | "hi-Latn" | "mr-Latn";
/** `via` says how the hit was found (EXACT: in the text as read until now; the others: in an extra reading of it, D168). Optional so existing callers and tests keep working. */
export type SafetyHit = { rule: string; category: SafetyCategory; language: SafetyLanguage; matched: string; via?: SafetyVia };
export type { SafetyVia } from "./safety-normalize";

/**
 * WORD: the term must stand as a whole word (a letter, vowel sign or digit may not touch it on either side): "gas" does not hit "gasket".
 * STEM: only the start must be a word start; the word may go on: a Devanagari stem covers its inflections (अडकल covers अडकली, अडकलो, अडकले).
 */
type Kind = MatchKind;
type Rule = {
  id: string;
  category: SafetyCategory;
  language: SafetyLanguage;
  kind: Kind;
  terms: readonly string[];
  except?: RegExp;
  /** Terms of `terms` that name only the electricity "current" (a bare करंट or "current"): they hit only when the same text has a shock word (D169). */
  needsShockContext?: readonly string[];
};

const rule = (id: string, category: SafetyCategory, language: SafetyLanguage, kind: Kind, terms: readonly string[], except?: RegExp, needsShockContext?: readonly string[]): Rule => ({
  id,
  category,
  language,
  kind,
  terms,
  except,
  needsShockContext,
});

/**
 * THE RULES. HIGH RECALL over precision: a missed fire is worse than a false alarm, so a rule may also hit a sentence that is not an incident
 * ("fire exit", "gas bill", "no fire": there is NO negation handling, on purpose). The Hindi and Marathi lists are NOT yet verified by a native
 * speaker (docs/safety-words-review.md). The first four categories are the brief's; MEDICAL_VIOLENCE is a human-added fifth (D153, docs/assumptions.md).
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
  rule("SHOCK_HI_KARANT", "SHOCK", "hi", "STEM", ["करंट", "करेंट", "करंट लगा", "करंट लग", "करेंट लग", "करंट आ रहा"], undefined, ["करंट", "करेंट", "करंट आ रहा"]),
  rule("SHOCK_HI_JHATKA", "SHOCK", "hi", "STEM", ["बिजली का झटका", "बिजली के झटके", "बिजली झटका", "बिजली का झटका लगा", "बिजली का शॉक"]),
  rule("SHOCK_HI_SHOCK", "SHOCK", "hi", "STEM", ["शॉक", "शाक लग", "शॉक लगा", "इलेक्ट्रिक शॉक", "शौक लगा"]),
  rule("SHOCK_HI_TAR", "SHOCK", "hi", "STEM", ["नंगा तार", "खुला तार", "टूटा तार", "तार टूट", "बिजली का नंगा", "खुले तार"]),
  rule("SHOCK_HI_LAG", "SHOCK", "hi", "STEM", ["बिजली लग", "बिजली का करंट", "करंट आ", "दीवार में करंट", "नल में करंट", "पानी में करंट"], undefined, ["बिजली का करंट", "करंट आ"]),
  rule("SHOCK_MR_DHAKKA", "SHOCK", "mr", "STEM", ["विजेचा धक्का", "विजेचा झटका", "विजेचा शॉक", "वीज धक्का", "वीजेचा धक्का", "विजेचे धक्के"]),
  rule("SHOCK_MR_KARANT", "SHOCK", "mr", "STEM", ["करंट", "करंट लागला", "करंट लागत", "करंट आला", "करेंट लागला"], undefined, ["करंट", "करंट आला"]),
  rule("SHOCK_MR_SHOCK", "SHOCK", "mr", "STEM", ["शॉक", "शॉक लागला", "शॉक बसला", "शॉक बसत", "शॉक लागत"]),
  rule("SHOCK_MR_BASLA", "SHOCK", "mr", "STEM", ["वीज लागली", "वीज लागल", "विजेचा झटका बसला", "धक्का बसला विजे"]),
  rule("SHOCK_MR_WIRE", "SHOCK", "mr", "STEM", ["उघडी वायर", "उघड्या वायर", "वायर तुटली", "तार तुटली", "उघडी तार", "उघडा तार"]),
  rule("SHOCK_HI_LATN_SHOCK", "SHOCK", "hi-Latn", "WORD", ["shock laga", "shock lag", "shock lagi", "shock lagta", "shock mara", "shock lag gaya"]),
  rule("SHOCK_HI_LATN_CURRENT", "SHOCK", "hi-Latn", "WORD", ["current laga", "current lag", "current lagta", "current aa raha", "current aata", "karant laga", "karant lag", "karent laga", "current maar"], undefined, ["current aa raha", "current aata"]),
  rule("SHOCK_HI_LATN_JHATKA", "SHOCK", "hi-Latn", "WORD", ["bijli ka jhatka", "bijli ka jhatke", "bijli ka jhatka laga", "bijli lag", "bijli lag gayi", "bijli ka current"], undefined, ["bijli ka current"]),
  rule("SHOCK_HI_LATN_TAAR", "SHOCK", "hi-Latn", "WORD", ["nanga taar", "nange taar", "khula taar", "khule taar", "taar toot", "taar tuta"]),
  rule("SHOCK_MR_LATN_DHAKKA", "SHOCK", "mr-Latn", "WORD", ["vijecha dhakka", "viji cha dhakka", "vijecha shock", "current laagla", "current lagla", "shock laagla", "shock baisla", "karant laagla"]),
  rule("SHOCK_MR_LATN_WIRE", "SHOCK", "mr-Latn", "WORD", ["ughadi tar", "ughadi wire", "wire tutli", "tar tutli", "ughdi wire"]),
  // MEDICAL_VIOLENCE (D153: a human-added fifth category: someone is hurt, ill, attacked or dead; the ids start with MV_)
  rule("MV_EN_AMBULANCE", "MEDICAL_VIOLENCE", "en", "WORD", ["ambulance", "ambulances", "ambulence", "paramedic", "paramedics"]),
  rule("MV_EN_COLLAPSE", "MEDICAL_VIOLENCE", "en", "WORD", ["unconscious", "unconcious", "fainted", "fainting", "passed out", "collapsed", "unresponsive", "not responding", "fell unconscious"]),
  rule("MV_EN_BREATH", "MEDICAL_VIOLENCE", "en", "WORD", ["not breathing", "stopped breathing", "cannot breathe", "cant breathe", "unable to breathe", "difficulty breathing", "struggling to breathe", "gasping for air"]),
  rule("MV_EN_CARDIAC", "MEDICAL_VIOLENCE", "en", "WORD", ["heart attack", "cardiac arrest", "chest pain", "chest pains", "seizure", "seizures", "epileptic fit", "stroke", "paralysis attack"]),
  rule("MV_EN_BLOOD", "MEDICAL_VIOLENCE", "en", "WORD", ["blood", "bleed", "bleeds", "bleeding", "bloody", "bloodied", "blood loss"]),
  rule("MV_EN_INJURY", "MEDICAL_VIOLENCE", "en", "WORD", ["injured", "injury", "injuries", "badly hurt", "seriously hurt", "severely hurt", "wounded", "fractured", "fracture", "head injury"]),
  rule("MV_EN_ATTACK", "MEDICAL_VIOLENCE", "en", "WORD", ["stabbed", "stabbing", "shot", "shooting", "gunshot", "gunshots", "attacked", "attacking", "attacker", "assault", "assaulted", "beaten up", "being beaten", "molested"]),
  rule("MV_EN_DEATH", "MEDICAL_VIOLENCE", "en", "WORD", ["murder", "murdered", "killed", "killing", "dead body", "someone died", "person died", "has died", "died", "found dead", "passed away"]),
  rule("MV_EN_DROWN_KIDNAP", "MEDICAL_VIOLENCE", "en", "WORD", ["drowning", "drowned", "kidnap", "kidnaps", "kidnapped", "kidnapping", "abducted", "abduction"]),
  rule("MV_EN_WEAPON", "MEDICAL_VIOLENCE", "en", "WORD", ["knife", "knives", "gun", "guns", "weapon", "weapons", "pistol", "revolver", "sword", "machete"]),
  rule("MV_HI_AMBULANCE", "MEDICAL_VIOLENCE", "hi", "STEM", ["एम्बुलेंस", "एंबुलेंस", "एम्बुलेन्स", "एंबुलेन्स", "अम्बुलेंस", "ऐम्बुलेंस"]),
  rule("MV_HI_BEHOSH", "MEDICAL_VIOLENCE", "hi", "STEM", ["बेहोश", "अचेत", "होश नहीं", "होश में नहीं", "बेसुध"]),
  rule("MV_HI_BREATH", "MEDICAL_VIOLENCE", "hi", "STEM", ["सांस नहीं", "सांस रुक", "सांस लेने में", "सांस फूल", "दम घुट", "सांस नही"]),
  rule("MV_HI_CARDIAC", "MEDICAL_VIOLENCE", "hi", "STEM", ["हार्ट अटैक", "हार्टअटैक", "दिल का दौरा", "दौरा पड़", "मिर्गी", "सीने में दर्द", "छाती में दर्द", "हृदयघात", "लकवा"]),
  rule("MV_HI_KHOON", "MEDICAL_VIOLENCE", "hi", "STEM", ["खून", "रक्त", "लहूलुहान", "रक्तस्राव"]),
  rule("MV_HI_GHAYAL", "MEDICAL_VIOLENCE", "hi", "STEM", ["घायल", "जख्मी", "जख्म", "गंभीर चोट", "सिर में चोट", "चोट लग", "हड्डी टूट", "फ्रैक्चर", "चोटिल"]),
  rule("MV_HI_WEAPON", "MEDICAL_VIOLENCE", "hi", "STEM", ["चाकू", "छुरा", "छुरी", "गोली", "गोलीबारी", "बंदूक", "बन्दूक", "हथियार", "पिस्तौल", "तलवार", "कट्टा"]),
  rule("MV_HI_ATTACK", "MEDICAL_VIOLENCE", "hi", "STEM", ["हमला", "हमले", "हमलावर", "मारपीट", "मार दिया", "मार डाला", "पिटाई", "पीटा", "पीट रहे", "पीट रहा"]),
  rule("MV_HI_DEATH", "MEDICAL_VIOLENCE", "hi", "STEM", ["हत्या", "कत्ल", "मर गया", "मर गई", "मर गये", "मर गए", "मौत", "लाश", "मृत"]),
  rule("MV_HI_DROWN_KIDNAP", "MEDICAL_VIOLENCE", "hi", "STEM", ["अपहरण", "किडनैप", "डूब रहा", "डूब रही", "डूब गया", "डूब गई", "डूबने"]),
  rule("MV_MR_AMBULANCE", "MEDICAL_VIOLENCE", "mr", "STEM", ["रुग्णवाहिका", "रुग्णवाहीका", "अॅम्ब्युलन्स", "ऍम्ब्युलन्स", "ॲम्ब्युलन्स", "अँब्युलन्स", "एम्बुलेन्स", "अम्बुलन्स"]),
  rule("MV_MR_BEHOSH", "MEDICAL_VIOLENCE", "mr", "STEM", ["बेशुद्ध", "बेशुध्द", "बेहोश", "शुद्ध हरपली", "शुद्ध हरपला", "भोवळ"]),
  rule("MV_MR_BREATH", "MEDICAL_VIOLENCE", "mr", "STEM", ["श्वास घेता येत नाही", "श्वास घेण्यास त्रास", "श्वास थांबला", "श्वास कोंडला", "दम लागत", "धाप लागत", "दम कोंडला"]),
  rule("MV_MR_CARDIAC", "MEDICAL_VIOLENCE", "mr", "STEM", ["हृदयविकार", "हार्ट अटॅक", "हार्ट अॅटॅक", "छातीत दुखत", "छातीत कळ", "फिट आली", "फिट आला", "फेफरे", "अर्धांगवायू", "पक्षाघात"]),
  rule("MV_MR_RAKTA", "MEDICAL_VIOLENCE", "mr", "STEM", ["रक्त", "रक्तबंबाळ", "रक्तस्राव", "रक्तस्त्राव"]),
  rule("MV_MR_JAKHMI", "MEDICAL_VIOLENCE", "mr", "STEM", ["जखम", "गंभीर जखम", "डोक्याला मार", "डोक्याला लागले", "हाड मोडले", "फ्रॅक्चर"]),
  rule("MV_MR_WEAPON", "MEDICAL_VIOLENCE", "mr", "STEM", ["चाकू", "गोळी", "गोळीबार", "बंदूक", "बंदुक", "शस्त्र", "पिस्तूल", "तलवार", "कोयता"]),
  rule("MV_MR_ATTACK", "MEDICAL_VIOLENCE", "mr", "STEM", ["हल्ला", "हल्लेखोर", "मारहाण", "मारामारी", "जीवे मार", "मारून टाक"]),
  rule("MV_MR_DEATH", "MEDICAL_VIOLENCE", "mr", "STEM", ["खून", "हत्या", "मृत्यू", "मृतदेह", "प्रेत", "मरण पाव", "जीव गेला", "जीव गेली"]),
  rule("MV_MR_DROWN_KIDNAP", "MEDICAL_VIOLENCE", "mr", "STEM", ["अपहरण", "किडनॅप", "बुडत", "बुडाला", "बुडाली", "बुडून"]),
  rule("MV_HI_LATN_AMBULANCE", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["ambulance bulao", "ambulance bulaiye", "ambulance bula do", "ambulance chahiye", "ambulans"]),
  rule("MV_HI_LATN_BEHOSH", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["behosh", "behoosh", "behosh ho gaya", "behosh ho gayi", "hosh nahi", "hosh nahin", "hosh me nahi", "hosh mein nahi"]),
  rule("MV_HI_LATN_BREATH", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["saans nahi", "saans nahin", "saans nhi", "saans ruk", "saans lene mein takleef", "saans lene me dikkat", "dam ghut", "dum ghut"]),
  rule("MV_HI_LATN_CARDIAC", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["dil ka daura", "dil ka dora", "daura pada", "mirgi", "seene mein dard", "seene me dard", "chhati mein dard", "chhati me dard", "lakwa"]),
  rule("MV_HI_LATN_KHOON", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["khoon", "khun", "khoon beh raha", "khoon nikal raha", "lahuluhan", "rakt", "khoon nikla"]),
  rule("MV_HI_LATN_GHAYAL", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["ghayal", "zakhmi", "jakhmi", "chot lagi", "chot lag gayi", "gambhir chot", "sar mein chot", "haddi tut", "haddi toot"]),
  rule("MV_HI_LATN_WEAPON", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["chaku", "chakoo", "chaaku", "goli", "goliyan", "goli chali", "bandook", "banduk", "talwar", "katta", "tamancha", "hathiyar", "chhura", "chhuri"]),
  rule("MV_HI_LATN_ATTACK", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["hamla", "hamla kiya", "hamlawar", "maar diya", "maar dala", "maar daala", "maarpit", "marpit", "maar peet", "pitai"]),
  rule("MV_HI_LATN_DEATH", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["hatya", "katl", "qatal", "mar gaya", "mar gayi", "mar gaye", "maut", "laash", "mrit", "jaan se maar"]),
  rule("MV_HI_LATN_DROWN_KIDNAP", "MEDICAL_VIOLENCE", "hi-Latn", "WORD", ["doob raha", "doob rahi", "doob gaya", "doob gayi", "apaharan", "agwa", "agva"]),
  rule("MV_MR_LATN_AMBULANCE", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["ambulance bolava", "ambulance bolwa", "ambulance pathva", "ambulance pahije", "rugnavahika", "rugnavahika bolava"]),
  rule("MV_MR_LATN_BEHOSH", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["beshudh", "beshuddh", "beshuddha", "bhoval", "bhowal", "bhoval aali", "chakkar yeun pad", "shudh haravli", "behosh zala", "behosh zali"]),
  rule("MV_MR_LATN_BREATH", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["shwas gheta yet nahi", "shvas gheta yet nahi", "shwas thambla", "dam lagto", "dhaap lagte", "dhap lagte", "dam kondla", "shwas kondla", "shwas ghenyas tras"]),
  rule("MV_MR_LATN_CARDIAC", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["hrudayvikar", "hruday vikar", "chhatit dukhtay", "chhatit dukhte", "chhatit dukhat", "chhatit kal", "chatit dukhtay", "fit aali", "fit aala", "phephre"]),
  rule("MV_MR_LATN_RAKTA", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["rakta", "raktabambal", "raktasrav", "raktastrav", "rakta yet aahe"]),
  rule("MV_MR_LATN_JAKHMI", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["jakhmi", "jakhami", "jakham", "jakham zali", "jakhmi zala", "gambhir jakham", "dokyala mar", "dokyala lagle", "had modle"]),
  rule("MV_MR_LATN_WEAPON", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["chaku", "chakku", "golibar", "golibaar", "goli zadli", "bandhuk", "shastra", "pistool", "koyta"]),
  rule("MV_MR_LATN_ATTACK", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["halla", "halla kela", "hallekhor", "marhan", "maramari", "jeeve mar", "jive mar", "marun taka", "marun takle"]),
  rule("MV_MR_LATN_DEATH", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["khoon zala", "khun zala", "khoon kela", "hatya zali", "mrutyu", "mrityu", "mrutyu zala", "mrutdeh", "mrutadeh", "jeev gela", "jiv gela", "maran pavla", "maran pavli"]),
  rule("MV_MR_LATN_DROWN_KIDNAP", "MEDICAL_VIOLENCE", "mr-Latn", "WORD", ["budat aahe", "budtay", "budun", "budala", "budali", "apaharan", "kidnap zala", "kidnap kela"]),
];

const LETTER_OR_MARK_OR_DIGIT = /[\p{L}\p{M}\p{N}]/u;

/**
 * The words that make a bare "current" a shock (D169): the text must also hold one of them. Latin (Hindi and Marathi typed in English letters
 * included) and Devanagari, whole words only ("लगातार" is not "लगा"). Every term that already names the shock itself ("current laga") needs no help.
 */
export const SHOCK_CONTEXT = compileTerms(
  [
    "laga", "lagla", "laagla", "lage", "lagta", "shock", "shocks", "jhatka", "jhatke", "zatka", "dhakka", "dhakke", "basla", "touched", "touching", "electrocuted", "chhune", "chhoone",
    "लगा", "लागला", "झटका", "झटके", "धक्का", "धक्के", "स्पर्श", "शॉक", "छूने", "छूते", "छुआ",
  ],
  "WORD",
);

type Compiled = Rule & { pattern: RegExp; barePattern: RegExp | null };

const COMPILED: readonly Compiled[] = SAFETY_RULES.map((r) => {
  const bare = r.needsShockContext ?? [];
  return {
    ...r,
    pattern: compileTerms(r.terms.filter((t) => !bare.includes(t)), r.kind),
    barePattern: bare.length === 0 ? null : compileTerms(bare, r.kind),
  };
});

/** The first match of a pattern in the text that the rule's exception does not cancel, or null. */
function firstMatch(pattern: RegExp, except: RegExp | undefined, text: string): string | null {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (except !== undefined) {
      const start = match.index ?? 0;
      let end = start + match[0].length;
      while (end < text.length && LETTER_OR_MARK_OR_DIGIT.test(text[end])) end += 1;
      if (except.test(text.slice(start, end))) continue;
    }
    return match[0];
  }
  return null;
}

/** Every rule applied to one text that is already folded for matching: one hit per rule that matches. */
function scan(text: string, via: SafetyVia): SafetyHit[] {
  const hits: SafetyHit[] = [];
  let shockContext: boolean | undefined;
  for (const compiled of COMPILED) {
    let matched = firstMatch(compiled.pattern, compiled.except, text);
    if (matched === null && compiled.barePattern !== null) {
      shockContext ??= firstMatch(SHOCK_CONTEXT, undefined, text) !== null;
      if (shockContext) matched = firstMatch(compiled.barePattern, compiled.except, text);
    }
    if (matched !== null) hits.push({ rule: compiled.id, category: compiled.category, language: compiled.language, matched, via });
  }
  return hits;
}

/**
 * Safety words in a complaint, as one hit per rule that matches (never more). The text is normalised first (NFC, zero-width characters out,
 * Devanagari digits to ASCII, 2,000 characters), lower-cased for Latin letters and folded for Devanagari, and the ORIGINAL words are what is
 * read: a translation is never used. `matched` is the matched text after that folding.
 *
 * Stage 1 (D168): the same rules also read up to six extra readings of the raw text (`normalizeForSafety`: spaces or dots between single letters,
 * stretched letters, digits for letters, other diacritics and variants) and the hits are added, one per rule, the first reading that finds it
 * naming it in `via`. A hit stays STRONG whichever reading found it. A bare "current" or करंट (the electricity of a bill or a power cut) hits only
 * when the text also has a shock word (D169). It never throws and has no state. It has NO negation handling, so "no fire" and "fire exit" hit: for a
 * safety rule a false alarm is cheaper than a missed fire. Known accepted false positives are listed in tests/domain/complaints/safety.test.ts and
 * docs/complaint-classification.md.
 */
export function detectSafetyWords(raw: string): SafetyHit[] {
  const exactText = foldForMatching(normalizeComplaintText(raw));
  if (exactText === "") return [];
  const hits = scan(exactText, "EXACT");
  const found = new Set(hits.map((h) => h.rule));
  const read = new Set([exactText]);
  for (const candidate of normalizeForSafety(raw)) {
    const text = foldForMatching(candidate.text);
    if (read.has(text)) continue;
    read.add(text);
    for (const hit of scan(text, candidate.via)) {
      if (found.has(hit.rule)) continue;
      found.add(hit.rule);
      hits.push(hit);
    }
  }
  return hits;
}

/** True when any rule hits. */
export const hasSafetyWord = (raw: string): boolean => detectSafetyWords(raw).length > 0;
