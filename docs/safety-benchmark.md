# Safety detection benchmark

**What this is.** A measurement of how well the safety-word detector (`detectSafetyWords`, `src/domain/complaints/safety.ts`) copes with spelling
variation: typing mistakes, stretched vowels, spaces and dots inside words, digits for letters, other romanisations, missing or wrong vowel signs in
Devanagari. **It measures only. The detector, its helpers and every existing test are unchanged** (D162; the run's instruction D125: keep the current rules, measure, decide
improvements later with data). There is no pass or fail threshold on recall in this phase.

**The result in one paragraph.** On a 5,000-item holdout of single-operation misspellings, the detector found **36.0% (34.7 to 37.3; 1799/5000)**
(dev: 36.9% (35.6 to 38.2; 1844/5000)). With two different damages in one phrase it found 17.5% (16.1 to 19.1; 438/2500). It is robust to case,
zero-width characters, the nukta and chandrabindu (100% on those operations) and not robust to nearly everything else: a left-out or doubled letter, a
stretched vowel, a space inside a word, digits for letters, or a changed vowel sign defeat it most of the time. The benign sentences made from the seed
complaint templates and ordinary topics gave **0 false alarms in about 1,250 sentences**; the near-miss sentences gave about 22 to 25% false
alarms (3.4 to 3.9% of all negatives), because that list deliberately includes everyday words that ARE rule words (see "False alarms"). This is a synthetic benchmark: read "Limits" before quoting a number.

## Method, in plain words

- **Base phrases** (`base.ts`). The list of canonical positives, built without changing any rule: every term of every rule in the rule table, plus the
  words each rule matched in every positive case of the existing safety tests (those add no new phrase: the matched words are already rule terms).
  A phrase is kept only if its own rule detects it, unperturbed, on its own. 873 phrases were kept and 0 dropped.
  Per category: FIRE 108, GAS 101, LIFT_STUCK 126, SHOCK 126, MEDICAL_VIOLENCE 412. Per language form: English 228, Hindi (Devanagari) 182, Marathi (Devanagari) 156, Romanised Hindi 171, Romanised Marathi 136.
  Every one of the 129 rules has at least one base phrase (a test).
- **A perturbation** (`operations.ts`, `perturb.ts`) damages the letters of the safety words the way a person under stress, a small keyboard or another
  habit of spelling might. 17 operations: for Latin letters (English and the two romanised forms) swap adjacent letters, drop a letter, double a letter,
  insert or substitute a letter from the neighbouring QWERTY key, stretch a vowel to three, random case, insert a space or dot between letters, remove the
  spaces between the words, leet (0 o, 1 i, 3 e, 4 a, 5 s, @ a, $ s); for the romanised forms also spelling variants (aa/a, ee/i, oo/u, v/w, ph/f, a trailing a or h);
  for Devanagari add or remove the nukta, swap chandrabindu and anusvara, insert a zero-width joiner or non-joiner inside a word, swap short and long vowel signs,
  drop a vowel sign, double a consonant. An operation that does not apply to a script is skipped for it. A step that would change nothing is rejected and another is tried.
  A **single** item has one operation, a **double** item two different ones.
- **Why only the safety words.** The context is ordinary text and the question is "does the detector still see the emergency word", not "does it survive noise
  everywhere". Damaging the context would also make some items unreadable for a person. Every word of a base phrase (for example "gas ka smell") is treated as a safety word.
- **Contexts** (`contexts.ts`). Each perturbed phrase goes into a short, benign sentence chosen by the generator from a fixed list of 48 per language form
  (8 openings × 6 endings: "Hello, … near block C.", "bhai please urgent … tower 3 mein.", "नमस्ते, … ब्लॉक सी के पास।"). A test runs the detector on every context
  alone: zero hits.
- **What "detected" means.** `detectSafetyWords(text)` returns at least one hit (any rule, any category). A hit by a different rule than the base counts as detected, because
  the question is whether the complaint is seen as a safety complaint. There is no weak tier yet.
- **Sampling.** A language form is drawn first (each form gets about a fifth of the items), then a base phrase of that form, so categories follow the number of phrases
  (medical and violence has 412 of 873) and are reported separately. Among the operations that can change the phrase, one is drawn at random: an
  operation that fits fewer phrases (chandrabindu) has fewer items.
- **Negatives** (`negatives.ts`). Three groups: GENERATED (complaint bodies from the seed templates, plus benign topics inside the contexts of each form: 100 + 200 per seed),
  NEAR_MISS (words close to safety words in the same contexts: fine, five, hire, wire, tire, fare, gust, gasket, gastric, shocking, current account, liftoff, fireplace, bloodwork,
  blood donation, knifeblock, kitchen knife set, ambulatory, and Devanagari and romanised ones: 50 per seed) and EXISTING (the 97 negative sentences of the existing
  safety tests, which hit nothing by construction). A hit on a negative is a **false alarm**; none is filtered out.
- **Intervals.** Every rate has a 95% Wilson score interval (`wilson.ts`, tested against known values).

## Procedure and order (followed exactly)

1. Base list, generator, negatives and evaluator were built with their unit tests (commits `7b1bfb7`, `3b8119a`, `2eb816e`).
2. **Dev set**: seeds 301 to 305, each 1,000 single and 500 double items (7,500 items), plus the negatives. Run: baseline recorded.
3. **Freeze** (commit `fe9f75a`). Committed in `tests/fixtures/safety/dev/`: the seeds and sizes, the generator version `safety-perturb-1`, a SHA-256 digest of the canonical serialisation of every seed's texts and truths, 100 sample
   items per operation (`sample.jsonl`), `expected.json` (all numbers in this document), a README. The 7,500 texts are not stored. A drift test per seed regenerates the set and asserts the digest, counts, sample and every metric recomputed with the current detector.
4. **Holdout**: only then, seeds 9301 to 9305, same sizes, the same generator (a test asserts the version string; `git diff fe9f75a -- src/domain/complaints/safety-benchmark` was empty before the run). Run **once** and committed in a later commit (`31033c5`). Nothing (generator, base list, contexts, negatives, detector) was changed after seeing the holdout numbers.

Dev set digest `23a242df3210780947c78942a935f5416df9c1e0fc5831d8b8a8ca6946508164`; holdout digest `117541b051e1a4b1fd82c1f593b3e24a156c9a5413cc7d900e56587551937f9f` (digest of the per-seed digests; the per-seed digests are in each `expected.json`).

## Headline numbers

| | Dev (seeds 301 to 305) | Holdout (seeds 9301 to 9305) |
|---|---|---|
| **Single-operation recall, all forms combined (THE headline)** | **36.9% (35.6 to 38.2; 1844/5000)** | **36.0% (34.7 to 37.3; 1799/5000)** |
| Double-operation recall | 16.6% (15.2 to 18.1; 414/2500) | 17.5% (16.1 to 19.1; 438/2500) |
| False-alarm rate, all negatives | 3.9% (3.0 to 4.9; 62/1608) | 3.4% (2.7 to 4.5; 55/1595) |
| False alarms, GENERATED benign sentences | 0.0% (0.0 to 0.3; 0/1262) | 0.0% (0.0 to 0.3; 0/1250) |
| False alarms, NEAR_MISS words | 24.9% (19.9 to 30.6; 62/249) | 22.2% (17.5 to 27.8; 55/248) |
| False alarms, EXISTING test negatives | 0.0% (0.0 to 3.8; 0/97) | 0.0% (0.0 to 3.8; 0/97) |

The dev and holdout intervals overlap: the holdout confirms the dev baseline. Speed: 1,000 detections take about 0.07 s and the evaluator about 0.07 s per 1,000 items on this machine (tests allow 1 s and 0.5 s on 2 CPUs).

## Recall by language form, category and operation

### Language form

**Single-operation items**

| Form | Dev recall (95% CI) | Holdout recall (95% CI) |
|---|---|---|
| ENGLISH | 18.8% (16.5 to 21.3; 187/996) | 20.4% (18.0 to 22.9; 216/1061) |
| HINDI_DEVANAGARI | 57.8% (54.8 to 60.7; 609/1054) | 57.5% (54.4 to 60.6; 556/967) |
| MARATHI_DEVANAGARI | 59.1% (56.0 to 62.1; 572/968) | 58.9% (55.9 to 61.9; 591/1003) |
| ROMANISED_HINDI | 24.5% (22.0 to 27.3; 245/999) | 21.4% (19.0 to 24.1; 211/984) |
| ROMANISED_MARATHI | 23.5% (21.0 to 26.3; 231/983) | 22.8% (20.3 to 25.6; 225/985) |

**Double-operation items** (an item counts under each of its two operations)

| Form | Dev recall (95% CI) | Holdout recall (95% CI) |
|---|---|---|
| ENGLISH | 2.6% (1.5 to 4.3; 13/507) | 7.4% (5.4 to 10.0; 37/501) |
| HINDI_DEVANAGARI | 29.4% (25.6 to 33.6; 146/496) | 30.7% (26.7 to 35.0; 145/473) |
| MARATHI_DEVANAGARI | 34.3% (30.2 to 38.8; 158/460) | 35.8% (31.8 to 40.1; 186/519) |
| ROMANISED_HINDI | 8.6% (6.5 to 11.3; 45/524) | 7.6% (5.6 to 10.2; 38/502) |
| ROMANISED_MARATHI | 10.1% (7.8 to 13.1; 52/513) | 6.3% (4.5 to 8.8; 32/505) |

### Category

**Single-operation items**

| Category | Dev recall (95% CI) | Holdout recall (95% CI) |
|---|---|---|
| FIRE | 47.3% (43.5 to 51.2; 300/634) | 44.6% (40.8 to 48.5; 287/643) |
| GAS | 65.6% (61.6 to 69.5; 361/550) | 66.5% (62.7 to 70.1; 403/606) |
| LIFT_STUCK | 28.4% (25.2 to 31.8; 203/714) | 27.4% (24.2 to 30.8; 192/702) |
| MEDICAL_VIOLENCE | 28.4% (26.6 to 30.3; 677/2382) | 28.0% (26.3 to 29.9; 650/2318) |
| SHOCK | 42.1% (38.5 to 45.7; 303/720) | 36.5% (33.1 to 40.1; 267/731) |

**Double-operation items** (an item counts under each of its two operations)

| Category | Dev recall (95% CI) | Holdout recall (95% CI) |
|---|---|---|
| FIRE | 24.5% (20.0 to 29.7; 73/298) | 23.4% (18.8 to 28.7; 65/278) |
| GAS | 39.9% (34.5 to 45.5; 118/296) | 40.9% (35.4 to 46.6; 121/296) |
| LIFT_STUCK | 8.0% (5.6 to 11.3; 29/362) | 8.9% (6.3 to 12.4; 30/338) |
| MEDICAL_VIOLENCE | 9.7% (8.1 to 11.5; 116/1200) | 10.0% (8.4 to 11.8; 119/1194) |
| SHOCK | 22.7% (18.6 to 27.4; 78/344) | 26.1% (22.0 to 30.7; 103/394) |

### Operation

**Single-operation items**

| Operation | Dev recall (95% CI) | Holdout recall (95% CI) |
|---|---|---|
| CHANDRABINDU_ANUSVARA | 100.0% (96.6 to 100.0; 109/109) | 100.0% (95.2 to 100.0; 76/76) |
| DOUBLE_CONSONANT | 32.2% (28.1 to 36.6; 151/469) | 30.6% (26.6 to 34.9; 143/468) |
| DOUBLE_LETTER | 17.3% (13.4 to 22.1; 51/294) | 18.5% (14.5 to 23.3; 54/292) |
| DROP_LETTER | 13.5% (10.0 to 18.1; 37/274) | 17.0% (13.2 to 21.7; 51/300) |
| DROP_VOWEL_SIGN | 16.9% (13.5 to 20.9; 67/396) | 15.3% (12.1 to 19.3; 60/391) |
| ELONGATE_VOWEL | 17.2% (13.3 to 21.9; 51/297) | 17.9% (14.0 to 22.7; 54/301) |
| INSERT_JOINER | 100.0% (99.2 to 100.0; 462/462) | 100.0% (99.2 to 100.0; 463/463) |
| INSERT_NEIGHBOUR | 16.8% (12.8 to 21.7; 46/274) | 11.0% (7.9 to 15.2; 31/282) |
| INSERT_SEPARATOR | 13.0% (9.6 to 17.4; 38/292) | 15.8% (12.3 to 20.2; 51/322) |
| LEET | 2.7% (1.4 to 5.2; 8/299) | 6.3% (4.0 to 9.8; 18/285) |
| NUKTA_TOGGLE | 100.0% (98.9 to 100.0; 331/331) | 100.0% (98.9 to 100.0; 344/344) |
| RANDOM_CASE | 100.0% (98.7 to 100.0; 297/297) | 100.0% (98.6 to 100.0; 278/278) |
| REMOVE_SPACES | 0.5% (0.1 to 2.8; 1/200) | 1.0% (0.3 to 3.6; 2/196) |
| ROMANISATION_VARIANT | 24.9% (19.0 to 31.8; 43/173) | 26.8% (21.0 to 33.6; 51/190) |
| SUBSTITUTE_NEIGHBOUR | 17.1% (13.3 to 21.8; 51/298) | 9.4% (6.6 to 13.2; 28/299) |
| SWAP_ADJACENT | 14.3% (10.7 to 18.9; 40/280) | 11.9% (8.7 to 16.2; 34/285) |
| SWAP_VOWEL_LENGTH | 23.9% (19.1 to 29.5; 61/255) | 26.8% (21.4 to 32.9; 61/228) |

**Double-operation items** (an item counts under each of its two operations)

| Operation | Dev recall (95% CI) | Holdout recall (95% CI) |
|---|---|---|
| CHANDRABINDU_ANUSVARA | 42.0% (31.8 to 52.8; 34/81) | 54.9% (44.1 to 65.2; 45/82) |
| DOUBLE_CONSONANT | 25.1% (21.3 to 29.3; 112/447) | 25.3% (21.6 to 29.5; 117/462) |
| DOUBLE_LETTER | 7.3% (4.9 to 10.8; 22/302) | 7.5% (5.0 to 11.1; 22/294) |
| DROP_LETTER | 5.2% (3.2 to 8.4; 15/287) | 7.6% (5.1 to 11.1; 23/303) |
| DROP_VOWEL_SIGN | 15.1% (12.0 to 18.9; 63/416) | 16.3% (13.1 to 20.2; 67/410) |
| ELONGATE_VOWEL | 5.0% (3.1 to 8.0; 16/320) | 7.7% (5.0 to 11.6; 20/260) |
| INSERT_JOINER | 43.1% (38.5 to 47.8; 184/427) | 43.8% (39.4 to 48.3; 205/468) |
| INSERT_NEIGHBOUR | 6.8% (4.5 to 10.2; 21/307) | 5.1% (3.2 to 8.1; 16/314) |
| INSERT_SEPARATOR | 8.7% (5.9 to 12.8; 23/263) | 11.1% (8.0 to 15.1; 33/298) |
| LEET | 2.4% (1.2 to 4.8; 7/293) | 1.4% (0.5 to 3.4; 4/296) |
| NUKTA_TOGGLE | 54.7% (49.1 to 60.2; 168/307) | 56.9% (51.6 to 62.1; 189/332) |
| RANDOM_CASE | 11.4% (8.3 to 15.5; 35/306) | 13.2% (9.8 to 17.6; 38/288) |
| REMOVE_SPACES | 0.0% (0.0 to 1.8; 0/212) | 0.5% (0.1 to 3.0; 1/183) |
| ROMANISATION_VARIANT | 15.5% (11.2 to 21.0; 33/213) | 8.8% (5.5 to 13.6; 17/194) |
| SUBSTITUTE_NEIGHBOUR | 7.8% (5.2 to 11.5; 22/282) | 6.1% (3.9 to 9.4; 18/295) |
| SWAP_ADJACENT | 8.6% (5.9 to 12.3; 26/303) | 7.6% (5.0 to 11.2; 22/291) |
| SWAP_VOWEL_LENGTH | 20.1% (15.5 to 25.7; 47/234) | 17.0% (12.7 to 22.3; 39/230) |

What the operation table says: the operations the detector already normalises (case, nukta, chandrabindu, zero-width joiners: 100%) are the only safe ones. The two Devanagari
forms do best overall (about 58% for a single operation) mostly because three of their six operations are normalised away; Latin-letter forms are near 20%.
Removing the spaces of a phrase (about 1%) and leet (3 to 6%) are almost always missed.

## The 25 most fragile rules (holdout, worst first)

Rules are ranked by holdout recall of the items whose base phrase belongs to them (single and double items together); "also in dev's 25" says whether the dev set ranked it as one of its 25 worst.
No rule was at 0% in the holdout; the worst has 1 of 57 items detected.

| # | Rule | Holdout recall (95% CI) | Also in dev's 25 |
|---|---|---|---|
| 1 | `SHOCK_MR_LATN_WIRE` | 1.8% (0.3 to 9.3; 1/57) | yes |
| 2 | `MV_HI_LATN_CARDIAC` | 2.6% (0.7 to 9.0; 2/77) | yes |
| 3 | `MV_HI_LATN_ATTACK` | 3.4% (1.2 to 9.7; 3/87) | yes |
| 4 | `GAS_EN_CO` | 4.7% (1.3 to 15.5; 2/43) | yes |
| 5 | `MV_HI_LATN_BREATH` | 5.1% (1.7 to 13.9; 3/59) | no |
| 6 | `MV_HI_LATN_WEAPON` | 5.2% (2.4 to 10.9; 6/115) | no |
| 7 | `SHOCK_EN_CURRENT` | 5.7% (1.9 to 15.4; 3/53) | no |
| 8 | `LIFT_EN_ALARM` | 5.7% (1.6 to 18.6; 2/35) | yes |
| 9 | `MV_MR_LATN_BREATH` | 5.8% (2.7 to 12.1; 6/103) | yes |
| 10 | `MV_EN_AMBULANCE` | 5.9% (1.6 to 19.1; 2/34) | yes |
| 11 | `FIRE_MR_LATN_DHUR` | 6.2% (2.4 to 14.8; 4/65) | no |
| 12 | `SHOCK_EN_WORD` | 6.7% (1.2 to 29.8; 1/15) | no |
| 13 | `MV_HI_LATN_DROWN_KIDNAP` | 6.8% (2.7 to 16.2; 4/59) | yes |
| 14 | `MV_EN_DROWN_KIDNAP` | 7.0% (2.4 to 18.6; 3/43) | yes |
| 15 | `SHOCK_HI_LATN_CURRENT` | 7.1% (3.3 to 14.6; 6/85) | yes |
| 16 | `LIFT_EN_LIFT_STUCK` | 7.1% (3.1 to 15.7; 5/70) | no |
| 17 | `MV_MR_LATN_RAKTA` | 7.1% (2.5 to 19.0; 3/42) | no |
| 18 | `MV_EN_ATTACK` | 7.2% (3.4 to 14.9; 6/83) | no |
| 19 | `MV_EN_COLLAPSE` | 7.2% (3.1 to 15.9; 5/69) | no |
| 20 | `SHOCK_HI_LATN_JHATKA` | 7.7% (3.0 to 18.2; 4/52) | no |
| 21 | `SHOCK_EN_EARTH` | 7.7% (2.7 to 20.3; 3/39) | no |
| 22 | `LIFT_EN_NO_EXIT` | 7.9% (3.7 to 16.2; 6/76) | yes |
| 23 | `MV_HI_LATN_DEATH` | 7.9% (4.1 to 14.9; 8/101) | yes |
| 24 | `LIFT_EN_STUCK_IN` | 8.0% (3.2 to 18.8; 4/50) | yes |
| 25 | `LIFT_HI_LATN_ATAK` | 8.2% (3.2 to 19.2; 4/49) | no |

Most are rules of typed-in-Latin Hindi and Marathi (short words with no other spelling accepted) and English multi-word phrases.

## The 15 most frequent miss patterns (holdout, single-operation items)

A pattern is a language form plus the operation that was applied. Three examples each (the first three misses in seed order); the examples are generated text, not real complaints.

1. **Hindi (Devanagari) phrases lose detection when a vowel sign (matra) is left out** (DROP_VOWEL_SIGN): 168 holdout misses (5.2% of all single-operation misses; dev 167).
   - `फ्लैट 502 से संदेश: धँआ आज सुबह से।`
   - `कृपया जल्दी आइए, छुर मेरे फ्लैट के बाहर, मदद कीजिए।`
   - `कृपया जल्दी आइए, टटा तार बेसमेंट में।`
2. **Marathi (Devanagari) phrases lose detection when a consonant is typed twice** (DOUBLE_CONSONANT): 163 holdout misses (5.1% of all single-operation misses; dev 142).
   - `कृपया लवकर या, फाययर बेसमेंटमध्ये.`
   - `साहेब, कोयतता ब्लॉक सी जवळ.`
   - `फ्लॅट 502 कडून निरोप: धक्का बसला वविजे बेसमेंटमध्ये.`
3. **Marathi (Devanagari) phrases lose detection when a vowel sign (matra) is left out** (DROP_VOWEL_SIGN): 163 holdout misses (5.1% of all single-operation misses; dev 162).
   - `सूचना: लिफ्टमध्य अडकून ब्लॉक सी जवळ.`
   - `सूचना: मतदेह ब्लॉक सी जवळ.`
   - `कृपया लवकर या, हल्ल माझ्या फ्लॅटबाहेर, मदत करा.`
4. **Hindi (Devanagari) phrases lose detection when a consonant is typed twice** (DOUBLE_CONSONANT): 162 holdout misses (5.1% of all single-operation misses; dev 176).
   - `सर, जजलने आज सुबह से।`
   - `सूचना: धधुंआ आज सुबह से।`
   - `फ्लैट 502 से संदेश: शाकक लग आज सुबह से।`
5. **English phrases lose detection when a letter is left out** (DROP_LETTER): 101 holdout misses (3.2% of all single-operation misses; dev 80).
   - `Please come fast, smell as since this morning.`
   - `Hi team, open wre on the 5th floor.`
   - `Message from flat 502: eapons near block C.`
6. **English phrases lose detection when digits, @ or $ stand in for letters** (LEET): 100 holdout misses (3.1% of all single-operation misses; dev 96).
   - `Please come fast, el3ctr0cut10n in the basement area.`
   - `Please come fast, unabl3 t0 g3t 0ut of lift since this morning.`
   - `Hi team, k1dn4pp1ng on the 5th floor.`
7. **English phrases lose detection when a space or a dot lands inside a word** (INSERT_SEPARATOR): 99 holdout misses (3.1% of all single-operation misses; dev 87).
   - `Hello, lif t got stuck outside my flat, please help.`
   - `Urgent: strok.e in the basement area.`
   - `Please come fast, u nconcious near block C.`
8. **English phrases lose detection when a vowel is stretched to three letters** (ELONGATE_VOWEL): 99 holdout misses (3.1% of all single-operation misses; dev 103).
   - `Sir, lift is jammeeed outside my flat, please help.`
   - `Urgent: fiiire has broken out outside my flat, please help.`
   - `Hello, suffocatiiion on the 5th floor.`
9. **English phrases lose detection when a letter is doubled** (DOUBLE_LETTER): 97 holdout misses (3.0% of all single-operation misses; dev 102).
   - `Reporting that trappedd in a lift in the basement area.`
   - `Message from flat 502: suffocaating since this morning.`
   - `Urgent: cardiac arrestt since this morning.`
10. **English phrases lose detection when a letter is replaced by the key next to it** (SUBSTITUTE_NEIGHBOUR): 96 holdout misses (3.0% of all single-operation misses; dev 90).
   - `Urgent: lift emergenct button in tower 3.`
   - `Message from flat 502: lift free rall on the 5th floor.`
   - `Good morning, there is macjete in tower 3.`
11. **Romanised Marathi phrases lose detection when two neighbouring letters change places** (SWAP_ADJACENT): 91 holdout misses (2.8% of all single-operation misses; dev 68).
   - `flat 502 kadun nirop: marnu taka aaj sakalpasun.`
   - `teamla kalvaycha aahe ki hdur basement madhe.`
   - `flat 502 kadun nirop: hchatit kal tower 3 madhe.`
12. **Romanised Marathi phrases lose detection when an extra letter from a neighbouring key creeps in** (INSERT_NEIGHBOUR): 90 holdout misses (2.8% of all single-operation misses; dev 70).
   - `flat 502 kadun nirop: rugnhavahika tower 3 madhe.`
   - `saheb, hrudazy vikar majhya flat baher, madat kara.`
   - `krupaya lavkar ya, lift masdhech band block C javal.`
13. **Romanised Hindi phrases lose detection when a letter is replaced by the key next to it** (SUBSTITUTE_NEIGHBOUR): 89 holdout misses (2.8% of all single-operation misses; dev 84).
   - `team ko batana hai ki sar mein chog mere flat ke bahar, madad kijiye.`
   - `sir jaldi aaiye, dhjan basement mein.`
   - `subah se lift mein kog phanse block C ke paas.`
14. **Romanised Marathi phrases lose detection when a space or a dot lands inside a word** (INSERT_SEPARATOR): 89 holdout misses (2.8% of all single-operation misses; dev 86).
   - `tatkal: bh oval aali majhya flat baher, madat kara.`
   - `flat 502 kadun nirop: mrut.adeh pachvya majalyavar.`
   - `majha naav Ravi aahe, aa.gicha majhya flat baher, madat kara.`
15. **Romanised Hindi phrases lose detection when digits, @ or $ stand in for letters** (LEET): 89 holdout misses (2.8% of all single-operation misses; dev 96).
   - `Hello, @gw4 paanchvi manzil par.`
   - `mera naam Ravi hai, chot l4g g@y1 mere flat ke bahar, madad kijiye.`
   - `Hello, curr3nt @a raha basement mein.`

All the examples are phrases a person would read without difficulty. The patterns are the operations of the "What the operation table says" paragraph, spread over the forms.

## False alarms (nothing hidden)

| Rule | Near-miss word that hit it | Dev (count) | Holdout (count) |
|---|---|---|---|
| `FIRE_EN_SMOKE_BURN` | smokeless | 0 | 1 |
| `FIRE_MR_DHUR` | धुरंधर | 1 | 3 |
| `GAS_EN_WORD` | gas bill | 6 | 2 |
| `GAS_EN_WORD` | gas lighter | 5 | 4 |
| `GAS_HI_WORD` | गैस लाइटर | 1 | 4 |
| `GAS_MR_WORD` | गॅस बिल | 6 | 2 |
| `MV_EN_ATTACK` | flu shot | 2 | 1 |
| `MV_EN_ATTACK` | photo shot | 1 | 3 |
| `MV_EN_BLOOD` | blood donation | 4 | 1 |
| `MV_EN_CARDIAC` | stroke of luck | 0 | 3 |
| `MV_EN_WEAPON` | kitchen knife set | 1 | 1 |
| `MV_HI_DEATH` | मौत का कुआँ फिल्म | 3 | 6 |
| `MV_HI_KHOON` | रक्तदान शिबिर | 5 | 4 |
| `MV_HI_KHOON` | रक्तदान शिविर | 3 | 2 |
| `MV_HI_LATN_WEAPON` | goli ki dawa | 4 | 0 |
| `MV_HI_WEAPON` | दवा की गोली | 2 | 1 |
| `MV_MR_JAKHMI` | जखमा भरणारे मलम | 2 | 4 |
| `MV_MR_LATN_RAKTA` | rakta dan shibir | 6 | 6 |
| `MV_MR_RAKTA` | रक्तदान शिबिर | 5 | 4 |
| `MV_MR_RAKTA` | रक्तदान शिविर | 3 | 2 |
| `SHOCK_HI_KARANT` | करंट अकाउंट | 10 | 7 |
| `SHOCK_MR_KARANT` | करंट अकाउंट | 10 | 7 |

All false alarms are in the NEAR_MISS group and every one is by a word that is **a rule word or contains one**, so these are the already documented price of high recall (no negation handling,
`docs/complaint-classification.md`, `tests/domain/complaints/safety.test.ts`): "gas bill", "gas lighter", "current account" (करंट अकाउंट), "blood donation" (रक्तदान), "kitchen knife set", "flu shot" and "photo shot", "stroke of luck", "smokeless" (the stem "smoke" covers it), मौत का कुआँ (a film title), "goli ki dawa" and दवा की गोली (a medicine tablet), जखमा भरणारे मलम (an ointment for wounds),
and the Marathi word धुरंधर (an expert), which starts with the fire stem धुर. The near-miss group is a deliberately hard sample: about a quarter of its sentences use such a word, so its rate is not an estimate of the real-world false-alarm rate. The words that are NOT rule words (fine, five, hire, wire, tire, fare, gust, gasket, gastric, fireplace, bloodwork, liftoff, ambulatory, knifeblock) caused no false alarm.
The 0 of about 1,250 GENERATED sentences (upper bound of the interval 0.31%) is the better estimate for ordinary benign complaints.

## Findings about the detector (recorded, not fixed)

No defect was found: every miss is a spelling the rule table does not list or normalise, and no hit was wrong in a way other than the documented accepted false positives. Observations for the human:

1. **Spaces are flexible only between the words of a listed phrase.** "gas leak" matches "gas-leak" and "gas  leak" but not "gasleak" (REMOVE_SPACES: about 1% recall), and a space or dot inside a word ("lif t", "stro.ke") is never seen.
2. **Repeated letters are not folded**, so "fiiire", "gass" (only because it is listed), "ffire" and "suffocaating" are missed.
3. **Short and long vowel signs are different spellings** in Devanagari ("लीफ्ट" is not "लिफ्ट"); the detector folds only the nukta and the chandrabindu.
4. **Digits for letters are not read as letters** ("f1r3", "g@s").

## Limits (read before quoting a number)

- The items are **synthetic and generator-made**, not complaints written by residents. The perturbations are a guess at how people mis-type; the real distribution is not known and the real recall may be higher or lower.
- **Perturbations of Devanagari may create non-words** that no resident would write (a doubled consonant can be nonsense); the Devanagari numbers are a worst case for those operations.
- The base list is **limited to what the rules already detect**: the benchmark cannot reveal MISSING phrases or categories (a word nobody listed), only how fragile the listed ones are.
- The detector has **no negation handling** (on purpose); the benchmark does not test it.
- A hit by any rule counts, so a phrase damaged into another rule's word still counts as detected.
- Contexts are short and benign; long complaints with several sentences, mixed scripts and real typos in the context are not tested.
- **Native-speaker review is still required** for the Hindi and Marathi word lists and for these test phrases (`docs/safety-words-review.md`).
- This is not a statement about safety in production. **The declared-danger question and the Emergency control remain the primary safety nets**; the word rules are a second net.

## Recommendation (FOR THE HUMAN TO APPROVE; nothing here is implemented)

The holdout single-operation combined recall is **36.0%, below the 97% line**, so staged improvements are proposed, ordered by benefit and risk. The "misses addressed" figures are the holdout single-operation misses of the operations a stage targets: an UPPER bound on what it could fix (out of 3201 misses, which is 64.0 percentage points).

| Stage | What | Operations it addresses | Misses addressed (holdout, single) | Upper-bound gain | False-alarm risk |
|---|---|---|---|---|---|
| 1 | Cheap normalisation applied to the text and the terms alike: fold repeated letters, let a space or dot inside a word and between the words of a phrase be optional. Case, zero-width characters, nukta and chandrabindu are already handled (100%). | DOUBLE_LETTER, ELONGATE_VOWEL, DOUBLE_CONSONANT, INSERT_SEPARATOR, REMOVE_SPACES | 1275 | up to +25.5 points | Low to medium: "fire exit" style hits do not change, but folding spaces can join two ordinary words ("a gas" and "leak"), and folding repeats widens every Latin term slightly |
| 2 | Generated spelling variants of every term (long/short vowel signs, dropped matras, romanisation variants aa/a, ee/i, v/w, ph/f, a trailing a or h) and a digit-to-letter map for words that mix letters and digits | LEET, SWAP_VOWEL_LENGTH, DROP_VOWEL_SIGN, ROMANISATION_VARIANT | 904 | up to +18.1 points | Medium: more terms means more accidental word matches in Hindi and Marathi, which has few ordinary words to check against; each variant needs the native-speaker review |
| 3 | Bounded fuzzy matching (edit distance 1 for terms of five or more letters, 2 for ten or more) with a WEAK tier: it notifies the duty manager but does not mark the complaint critical | SWAP_ADJACENT, DROP_LETTER, INSERT_NEIGHBOUR, SUBSTITUTE_NEIGHBOUR | 1022 | up to +20.4 points | Highest: "fire" is one letter from "five", "hire", "wire", "tire", "fare"; hence the weak tier and a stop list; measure with the near-miss group before shipping |

Each stage must be re-measured on a NEW holdout (the present one is spent for tuning purposes) and on the negatives before it ships, and the human approves each stage.
**Decision and trigger (D164):** do nothing now; revisit if the native-speaker review changes the lists, or if real complaints show misspelt safety words, or before go-live; when approved, start with stage 1.
Stage 1 is the cheapest and the only one that needs no new vocabulary.

## Rerun

`npm run safety:benchmark` recomputes both sets from their seeds, prints the headline numbers and exits non-zero if any differs from the committed `expected.json` (the unit tests do the same, per seed).
To regenerate a set (only when a change to the generator is wanted; a holdout is never regenerated to improve a number) see `tests/fixtures/safety/dev/README.md`.
