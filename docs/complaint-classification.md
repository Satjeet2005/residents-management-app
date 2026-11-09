# Complaint classification (T10a)

> Updated 2026-11-09: the adapters, the database writes and the screens described as missing in this paragraph now exist; see `docs/jev-integration.md`.

How a resident's complaint gets a category and an urgency, as pure code in `src/domain/complaints/`. No adapter, database, network or screen
exists yet: those come later and plug into the types here. Decisions: D2, D9, D15, D73, D86, D87, D88 (`docs/decisions.md`). The list of Hindi and
Marathi safety words for a native speaker to check is `docs/safety-words-review.md`.

## The pipeline, in words

1. **Safety rules first, on the original text.** The words the resident wrote (English, Hindi, Marathi, or Hindi and Marathi typed in Latin letters) are
   read for fire, gas, someone stuck in a lift, and electric shock. A hit makes the complaint CRITICAL and tells the duty manager. Nothing else can lower it.
2. **A model result, if there is one.** An adapter (built later) asks a model, on text with the personal data taken out, and returns probabilities
   for the category and the urgency, or nothing. A model is never trusted for safety: CRITICAL comes ONLY from the rules, and a model that answers
   CRITICAL is refused.
3. **A keyword fallback**, when no model result is usable.
4. **Triage**, when none of that gives a category: a person decides.

`decideClassification` (`decision.ts`) is the pure function that joins them. It takes the raw text, the answers of the arms (an arm is one way of asking
a model; `null` when it gave nothing) and a policy, and returns a `Decision`: category, urgency, `safetyFlag`, `source` (RULE, LLM, FALLBACK or
NONE), `confidence`, `needsTriage`, `escalateToDutyManager`, reason codes and the safety hits. The raw text is never modified; the text is cut to its
first 2,000 characters for reading only (`normalizeComplaintText`).

| Module | What it does |
|---|---|
| `taxonomy.ts` | The five categories, the four urgencies, the three urgencies a model may use (no CRITICAL), guards. |
| `text.ts` | Normalise (NFC, zero-width characters out, Devanagari digits to ASCII, whitespace, 2,000 characters), detect the script, guess romanised Hindi or Marathi. |
| `safety.ts` | 129 rules in five categories and five language families; `detectSafetyWords`. |
| `deidentify.ts` | Takes phones, e-mails, addresses of web pages, flat codes and names out of a text. |
| `fallback.ts` | Keyword reading: a category, an urgency. |
| `decision.ts` | R1 to R5, the policy, the reason codes, and the types `ClassifierPort` and `TranslatorPort` for the adapters. |
| `match.ts` | The word matcher the safety rules and the fallback share. |

## The rules R1 to R5

They are a small table in code (`DECISION_RULES`). They are applied as: R2 validates the arms, R3 accepts or refuses the model, R4 falls back, and R1 then
overrides for safety; R5 holds throughout.

| Rule | What it says | Example |
|---|---|---|
| **R1** | Any safety hit: `safetyFlag`, urgency CRITICAL, source RULE, escalate to the duty manager, no triage. The category comes from an accepted model result or the fallback, else null. The model and the fallback can never lower the urgency. | "my mother is stuck in the lift" with two arms that say LIFT 0.90 and 0.82: CRITICAL, category LIFT, confidence 0.82. "आग" alone: CRITICAL, category null, not triage. |
| **R2** | Every arm is validated: probabilities finite and in [0,1], each list non-empty with unique labels summing to 1 (within 0.001), only the labels of the taxonomy, and a model urgency can never be CRITICAL. An invalid arm is `INVALID_MODEL_OUTPUT` and counts as no answer. | An arm whose urgencies say `CRITICAL 1.0` is refused. |
| **R3** | With valid arms: if agreement is required and there are two or more, all must give the same top category and each top probability must reach the minimum (else `ARMS_DISAGREE` or `LOW_CONFIDENCE`, triage). One valid arm alone is accepted only when allowed (else `SINGLE_ARM_NOT_ALLOWED`). `confidence` is the lowest top probability of the accepted arms. Urgency is the agreed model urgency if its probability reaches the minimum, else NORMAL with `URGENCY_UNCERTAIN`; urgent words in the text raise it to HIGH and nothing lowers it. | Two arms say PLUMBING 0.91 and 0.78, urgency HIGH 0.8 and 0.7: LLM, PLUMBING, confidence 0.78, HIGH. |
| **R4** | No valid arm: the keyword fallback. A category gives source FALLBACK, `confidence` null, no triage. No category gives source NONE, triage, `NO_CLASSIFICATION`. | "water leak in the bathroom" with no arms: PLUMBING from the fallback. "something is wrong": triage. |
| **R5** | Deterministic, never throws; an empty or blank text goes to triage with `EMPTY_TEXT`. A bad policy value falls back to the default. | "" gives triage. |

Reason codes (for the later translation to words): SAFETY_WORD, INVALID_MODEL_OUTPUT, ARMS_DISAGREE, LOW_CONFIDENCE, URGENCY_UNCERTAIN,
URGENCY_FLOORED, URGENCY_KEPT_ON_REFUSAL, MODEL_UNAVAILABLE, FALLBACK_USED, NO_CLASSIFICATION, EMPTY_TEXT, SINGLE_ARM_NOT_ALLOWED (`REASON_CODES`).

## The safety words

- **Rules in a table** (`SAFETY_RULES`): an id, a category (FIRE, GAS, LIFT_STUCK, SHOCK: the brief's four, and MEDICAL_VIOLENCE, a human-added fifth, D153), a language (`en`, `hi`, `mr`,
  `hi-Latn`, `mr-Latn`), a match kind and the terms. There are 129 rules: FIRE 20, GAS 17, LIFT_STUCK 21, SHOCK 21, MEDICAL_VIOLENCE 50 (ids start with `MV_`, ten rules in each language family).
- **A Latin term is a whole word** ("gas" does not hit "gasket", "fire" does not hit "fireplace"). **A Devanagari term is a stem**: it starts a word and may be
  followed by more letters, so Marathi and Hindi endings hit (`अडकल` covers अडकली, अडकलो, अडकले). Where a stem is also the start of an everyday word the rule names the
  exception (`आग` does not hit `आगे`, ahead; `धूर` does not hit `धुरळा`, dust).
- **The text is normalised first**, then lower-cased for Latin letters, apostrophes dropped ("can't" is "cant") and Devanagari folded (nukta removed, chandrabindu
  made anusvara), and matched on its original words. A translation is never what is read.
- **Extra readings of the same text (Stage 1, D168).** The same rules also read up to six more readings of the RAW text, each made on its own: NFKC and case fold with zero-width characters,
  variation selectors and Latin diacritics out; letters joined where a word is spelled out with spaces or dots ("f i r e", "f.i.r.e"); a stretched letter reduced ("fiiire" reads "fire"); digits and `@` `$` read as the letters they
  look like inside a word that has a letter ("f1re", "g4s", but not "5th", "5b" or "1 of 3"); the Devanagari variants folded. The hits are added, one per rule, with a `via` field saying which reading found it
  (EXACT, NORMALISED, SQUASHED, ELONGATION, LEET). A hit found this way is as STRONG as any other: CRITICAL, flagged, escalated. No word was added to any rule (`src/domain/complaints/safety-normalize.ts`,
  `tests/domain/complaints/safety-normalize.test.ts`).
- **A bare "current" needs a shock word (D169).** The Devanagari करंट and the Latin "current aa raha", "current aata" and "bijli ka current" also name the electricity of a bill or a power cut ("तीन तासांपासून करंट नाही",
  "करंट बिल"), so these ten terms of five rules hit only when the same text also has a shock word (laga, shock, jhatka, dhakka, touched, लगा, झटका, धक्का, स्पर्श, शॉक, छूने and the others listed in `docs/safety-words-review.md`). "current laga",
  "करंट लगा", "विजेचा धक्का" and "electric shock" are unchanged. The price: "तार में करंट आ रहा है" with no shock word is no longer a hit.
- **High recall over precision**, on purpose: a missed fire is worse than a false alarm. So there is **no negation handling**: "no fire" and "there is no gas leak"
  still escalate, and some everyday sentences hit ("fire exit", "the gas bill", "shock absorber", "smoke detector", "cigarette smoke") and, for MEDICAL_VIOLENCE, "blood donation camp", "a blood test", "a kitchen knife set", "the plant died", "a photo shot", and the Hindi and Marathi `गोली`/`गोळी`, which also mean a tablet, and `रक्तदान` (blood donation). The accepted false
  positives are listed as tests (`tests/domain/complaints/safety.test.ts`, "accepted false positives") so a change that stops them is a decision, not an accident.
- **Known gaps**: only the first 2,000 characters are read; a spelling nobody thought of is missed (after Stage 1 still the left-out, swapped, inserted and replaced letters, a space inside a word, words run
  together and a changed Devanagari vowel sign: 13 to 28 percent recall each in the benchmark); "gas" alone is a hit but "gaas" is not. The lists are in a table so a native speaker's corrections are one line each.
- **NOT verified by a native speaker.** The Hindi, Marathi and romanised lists were written by the agent. `docs/safety-words-review.md` lists every non-English
  rule for a speaker to read, with an empty column for who reviewed it and when. Until then they are an unverified starting point, and the English rules are the
  only ones with any chance of being complete.
- **It never throws** on any input (empty, emoji, control characters, 5,000 characters, right-to-left text, lone surrogates), tested with 2,000 seeded random strings.

## How robust the safety words are to spelling variation

Measured: `docs/safety-benchmark.md` damages the safety words of every rule in 17 ways (a left-out or doubled letter, a stretched vowel, a space inside a word,
digits for letters, another romanisation, a changed Devanagari vowel sign, and so on) and counts how often the rules still fire. Before Stage 1 the single-operation recall
was 36.0% on the first holdout. After Stage 1 (D168) and the shock-context fix (D169), on a NEW holdout run once after the detector was frozen, it is **46.1% (95% CI 44.8 to 47.5)**, against 36.6% for the baseline
detector on the same texts; two damages in one phrase 20.8% (was 17.0%). A stretched letter (99.7%) and digits for letters (96.7%) are now read; case, zero-width characters, the nukta and the chandrabindu were already
(about 88 to 100%, a little lower than before only because ten bare-current terms now need a shock word). A left-out, swapped, inserted or replaced letter, a space inside a word, words run together and a changed vowel sign
are NOT improved (13 to 28%). The remaining stages are proposed with their measured size, risk, effort and trigger in `docs/safety-benchmark.md` ("NEXT STEPS", D170). `npm run safety:benchmark` recomputes the numbers.

## De-identification

Human decision (D88): complaint text goes to a third party only after personal data is taken out; the safety rules and the people read the original.
`deidentify(text, { knownNames })` replaces:

| What | Becomes |
|---|---|
| A run of ten or more digits (ASCII or Devanagari), with +91, 91, 0 and separators (space, hyphen, dot, round brackets) | `[PHONE]` |
| `local@domain`, including a UPI address such as `aamir.s@oksbi` | `[EMAIL]` |
| A web address (`http://`, `https://`, `www.`) | `[URL]` |
| A flat code, read with the matcher's `extractFlatTokens`, every spelling | `[FLAT]` |
| A name in `knownNames` (whole word, any case; the whole name first, then each word of 3 or more characters) | `[NAME]` |
| Mr, Mrs, Ms, Shri, Smt, Sri, Dr, Mister and the one or two capitalised words after it | `[NAME]` |

It is idempotent (a second pass changes nothing), never throws, returns only the kinds it replaced with their counts, and a test checks that no run of ten digits
(with or without separators) survives in 2,000 seeded random texts. **It cannot guarantee that all personal data is gone.** It does not know a name that is not in
`knownNames` and has no honorific, an address, a building name, a vehicle number, an account number under ten digits, or a fact told in the sentences themselves
("my husband works at the bank"). A name in Devanagari is replaced only when it is given exactly and stands alone as a word (an inflected form is not). A Devanagari
honorific is not read. A word that is both a name and an ordinary word is replaced everywhere. The technical design (TDD) of the adapter must say the same: the text it
sends has reduced personal data, never none.

## The thresholds are assumptions

`defaultClassificationPolicy` is a labelled assumption, to be set by the benchmark below.

| Value | Default | Meaning |
|---|---|---|
| `minCategoryProbability` | 0.70 | The lowest top-category probability an arm may have to be accepted. |
| `minUrgencyProbability` | 0.60 | The lowest top-urgency probability for the model's urgency to be used; below it urgency is NORMAL and `URGENCY_UNCERTAIN`. |
| `requireAgreement` | true | With two or more valid arms, all must agree. |
| `allowSingleArm` | false | One valid arm alone is not enough. This is conservative: until the benchmark says otherwise more complaints go to a person. A design that uses one arm sets it to true. |

## The urgency floor and the prompt (D197 to D199)

An accepted model urgency of LOW is stored as NORMAL, with the reason `URGENCY_FLOORED` (the model's answer is kept as `modelUrgency` in the `CLASSIFIED` event). It does not apply to the keyword fallback or the safety rules, and a model can never produce CRITICAL. Why: urgency fails the D87 bar in every language group, and under-rating is the dangerous error. The request text, the reviewed v2 and its pre-registered rule and result are in `jev-prompt.md`; v2 was not adopted.

## How a refused category treats urgency today

Before D203 a refused category threw the model's whole answer away, urgency included. `acceptArms` in `src/domain/complaints/decision.ts` returned a refusal BEFORE it looked at the urgency:

```ts
if (tops[0].category.probability < policy.minCategoryProbability) return { refusal: "LOW_CONFIDENCE" };
```

and `decideClassification` then wrote, for every refusal:

```ts
reasons.push(outcome.refusal);
needsTriage = true;
urgency = urgentWords ? "HIGH" : "NORMAL";
```

So with the category answer ELECTRICAL 0.63 (under 0.70) and the urgency answer HIGH 0.83 (over 0.60), the stored urgency was NORMAL (HIGH only if an urgent keyword was in the text), the category was null and `needsReview` was set (`needsReview: category === null` in `src/server/complaints/create.ts`). A confident, correct HIGH was lost. The keyword fallback is not used on a refusal: it answers only when there is no valid arm at all (R4).

## A confident HIGH survives a refused category (D203)

Now `acceptArms` also reports `keptHigh` on a refusal caused by the category (`LOW_CONFIDENCE`, `ARMS_DISAGREE`): true when the EXISTING urgency rule accepts the arms' urgency (all say the same label, each at 0.60 or more) and that label is HIGH. Then:

```ts
urgency = urgentWords || outcome.keptHigh ? "HIGH" : "NORMAL";
if (outcome.keptHigh) reasons.push("URGENCY_KEPT_ON_REFUSAL");
```

The category is still null, `needsTriage` and `needsReview` are set exactly as before, and the response clock is the HIGH target, so the complaint is on the staff board's "Needs action". Nothing else changes: a refused category still discards a NORMAL or LOW model urgency; the LOW floor, both thresholds (0.70 and 0.60), the keyword fallback and the safety rules are untouched; a model can never produce CRITICAL; `SINGLE_ARM_NOT_ALLOWED` (the arm is not used at all) keeps nothing. Why: refusing the category must not discard a confident same-day signal (D203). The threshold stays 0.60 (D202). Tests: "CP11" in `tests/domain/complaints/decision.test.ts` (table, a 2,000-answer differential test against the old logic) and the integration test in `tests/integration/complaints-create.test.ts`.

## The benchmark plan (partly run: see `classifier-benchmark.md`)

D86: three ways of asking the same model family ("Jev") and one comparator from another family:

- **Arm A, native**: the complaint in its own language, with the category and urgency options in English (`NATIVE`).
- **Arm B, translate first**: the text is translated to English, then classified (`TRANSLATED`).
- **Arm C, agreement gate**: A and B together; accepted only when they agree and both reach the minimum (`requireAgreement`).
- **A comparator** from another model family, classified directly (`DIRECT`), to see whether the result is about the method or about one model.

D87: the winning rule is the one that is at least 90 percent correct on the complaints it accepts, while accepting at least 60 percent of them, in EACH language group
(English, Hindi, Marathi, Hinglish). The rule and the numbers are fixed before the results are seen. Anything not accepted goes to a person, and the safety rules
are outside the benchmark: they decide on the original text before any model.

The test complaints are **agent-generated and labelled synthetic**, not real residents' words. A native speaker should spot-check a sample for each language before the
numbers are quoted, and every result will be reported as coming from synthetic data.

## Limits

- The Hindi and Marathi word lists (safety and keywords) are not verified by a native speaker.
- No negation handling in the safety rules; the keyword fallback cannot read meaning, only words.
- `looksRomanisedIndic` is a heuristic: a single Hindi word in an English sentence is missed, and an English sentence with two of the short words is taken for Hinglish.
- De-identification reduces personal data; it does not remove all of it.
- Only the first 2,000 characters of a complaint are classified.
- The thresholds are guesses until the benchmark runs. Updated 2026-11-09: the adapters, the database writes and the screens now exist (`docs/jev-integration.md`). The thresholds are still guesses; a synthetic benchmark was run once (`docs/classifier-benchmark.md`). Originally: no adapter, no database write and no screen existed; the `Classification` rows and the complaint fields they
  fill are written by a later task.

## Assumptions (labelled)

- **CC1.** CRITICAL is produced only by the safety rules; a model arm that says CRITICAL is invalid (D9, D73).
- **CC2.** With valid arms that are refused (disagree, low confidence, one alone), the keyword fallback does NOT supply a category: the complaint goes to a person. The
  fallback only answers when no arm is valid, or, after a safety hit, to name a category.
- **CC3.** Urgent words in the text raise the urgency to HIGH even when a model says NORMAL or LOW, and never lower it. "No hurry" words lower it to LOW only when the
  fallback alone decides.
- **CC4.** Without `requireAgreement`, the arm with the highest top probability leads, and the arms that agree with it and reach the minimum are the accepted ones.
- **CC5.** The arm names map to the benchmark as A = NATIVE, B = TRANSLATED, the comparator = DIRECT; C is a policy, not an arm.
- **CC6.** "OTHER" is chosen only when no other category matched and a general word did (noise, parking, dogs, security ...).
- **CC7.** D88 is the human decision that only de-identified text goes to a third party.
