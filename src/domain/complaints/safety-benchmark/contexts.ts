import type { LanguageForm } from "./types";

/** `{}` is where the (perturbed) safety words go. No context holds a safety word: a test runs the detector on each one alone. */
const PARTS: Readonly<Record<LanguageForm, { before: readonly string[]; after: readonly string[] }>> = {
  ENGLISH: {
    before: ["Hello, ", "Please come fast, ", "Urgent: ", "Sir, ", "Good morning, there is ", "Message from flat 502: ", "Hi team, ", "Reporting that "],
    after: [" near block C.", " on the 5th floor.", " in tower 3.", " since this morning.", " outside my flat, please help.", " in the basement area."],
  },
  HINDI_DEVANAGARI: {
    before: ["नमस्ते, ", "कृपया जल्दी आइए, ", "ज़रूरी: ", "सर, ", "सुप्रभात, यहाँ ", "फ्लैट 502 से संदेश: ", "टीम को बताना है कि ", "सूचना: "],
    after: [" ब्लॉक सी के पास।", " पाँचवीं मंज़िल पर।", " टावर 3 में।", " आज सुबह से।", " मेरे फ्लैट के बाहर, मदद कीजिए।", " बेसमेंट में।"],
  },
  MARATHI_DEVANAGARI: {
    before: ["नमस्कार, ", "कृपया लवकर या, ", "तातडीचे: ", "साहेब, ", "शुभ प्रभात, इथे ", "फ्लॅट 502 कडून निरोप: ", "टीमला कळवायचे आहे की ", "सूचना: "],
    after: [" ब्लॉक सी जवळ.", " पाचव्या मजल्यावर.", " टॉवर 3 मध्ये.", " आज सकाळपासून.", " माझ्या फ्लॅटबाहेर, मदत करा.", " बेसमेंटमध्ये."],
  },
  ROMANISED_HINDI: {
    before: ["bhai please urgent ", "Hello, ", "sir jaldi aaiye, ", "namaste, ", "subah se ", "flat 502 se message: ", "team ko batana hai ki ", "mera naam Ravi hai, "],
    after: [" block C ke paas.", " paanchvi manzil par.", " tower 3 mein.", " aaj subah se.", " mere flat ke bahar, madad kijiye.", " basement mein."],
  },
  ROMANISED_MARATHI: {
    before: ["namaskar, ", "krupaya lavkar ya, ", "tatkal: ", "saheb, ", "suprabhat, ithe ", "flat 502 kadun nirop: ", "teamla kalvaycha aahe ki ", "majha naav Ravi aahe, "],
    after: [" block C javal.", " pachvya majalyavar.", " tower 3 madhe.", " aaj sakalpasun.", " majhya flat baher, madat kara.", " basement madhe."],
  },
};

/** The fixed list of contexts of a language form: every prefix with every suffix (48 each). */
const contextsOf = (form: LanguageForm): readonly string[] => PARTS[form].before.flatMap((b) => PARTS[form].after.map((a) => `${b}{}${a}`));

export const CONTEXTS: Readonly<Record<LanguageForm, readonly string[]>> = {
  ENGLISH: contextsOf("ENGLISH"),
  HINDI_DEVANAGARI: contextsOf("HINDI_DEVANAGARI"),
  MARATHI_DEVANAGARI: contextsOf("MARATHI_DEVANAGARI"),
  ROMANISED_HINDI: contextsOf("ROMANISED_HINDI"),
  ROMANISED_MARATHI: contextsOf("ROMANISED_MARATHI"),
};

export const embed = (context: string, phrase: string): string => context.replace("{}", () => phrase);
