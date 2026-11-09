# The classifier request: prompt v1, prompt v2 and what was measured (D197, D198, D199)

**What this is.** The text the app sends to the two classifier providers, what the protocol lets us change, one improvement for urgency (v2), one measurement of it against a rule fixed beforehand, and the safety floor that was applied because urgency still fails. The data is synthetic (see `classifier-benchmark.md`).

## What the protocol allows

The request type in `src/server/complaints/providers/system-one.ts`:

```ts
export type SystemOneRequest = {
  model?: string;
  state: string;
  questions: { category: ChoiceQuestion; urgency: ChoiceQuestion };
};
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
```

The documented example (`tests/fixtures/system-one/docs-choice-request.json`, from the provider's OpenAPI example) has exactly the same fields. So the levers are: the label names (`criteria` keys), a description for each label (`criteria` values) and one `instructions` sentence per question. **There is no field for examples.** v2 therefore uses no examples (the task allowed them only if the protocol supports them).

## Prompt v1 (as shipped)

The exact body for the fictional complaint "The tube light in the 2nd floor passage is not working." (no URL, key or header; the model key is left out when no model is set):

```json
{
  "state": "The tube light in the 2nd floor passage is not working.",
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Which kind of problem does this complaint from a resident of a housing society describe?",
      "criteria": {
        "PLUMBING": "Water problems: a leak, a blocked drain, a tap, a pipe, no water, a toilet or bathroom fixture.",
        "ELECTRICAL": "Electrical problems: a light, a fan, a switch, a socket, a power cut, wiring, a meter.",
        "HOUSEKEEPING": "Cleaning and waste: garbage not collected, dirty stairs or corridors, sweeping, pests, gardening.",
        "LIFT": "The lift or elevator: slow, noisy, out of service, a button or door that does not work.",
        "OTHER": "Anything else: noise, parking, security, pets, neighbours, or something that fits none of the above."
      }
    },
    "urgency": {
      "type": "choice",
      "instructions": "How urgent is this complaint from a resident of a housing society?",
      "criteria": {
        "HIGH": "Needs action today: a service is fully out, or the problem is getting worse quickly.",
        "NORMAL": "An ordinary problem that should be fixed in the next day or two.",
        "LOW": "A small matter, a suggestion, or something that can wait several days."
      }
    }
  }
}
```

Length: 1,137 characters as compact JSON, of which 55 are the complaint and **1,082 are not** (category question 708, urgency question 400, counted with an empty complaint and one question each; the two sums differ from the total by the shared JSON frame). Every complaint is sent with BOTH questions in one call. The label set offered for urgency is HIGH, NORMAL and LOW; CRITICAL is never offered (only the safety rules produce it).

## Prompt v2

Selected with `CLASSIFIER_PROMPT_VERSION` (`'v1' | 'v2'`, default `'v1'`). The v1 path is untouched and pinned by a golden-string test. Changes:

1. **Urgency labels in product terms.** HIGH: "Someone must act TODAY: water entering a home, a whole wing or tower without power or water, a lift out of service, a blocked main drain, or a gate or access failure." NORMAL: "A routine repair that can be done within a day or two." LOW: "Cosmetic, convenience, noise, parking or a suggestion." Rationale: v1 defined urgency in abstract terms ("a service is fully out", "getting worse quickly"), and on the 32 measured items half of v1's urgency errors (3 of 6) were a NORMAL complaint answered LOW. Naming what the society treats as same-day gives the model the society's meaning instead of its own.
2. **A phrase on language**, added to both instructions: " The text may be in English, Hindi, Marathi or a mix." Rationale: a third of the complaints are not English and the model is not told.
3. **Category labels unchanged** (they are already one clause each); only the language phrase is added to the category instruction.

Size: v2's part that is not the complaint is 1,244 characters against 1,082 for v1 (+162 in all; category question +53, urgency question +109), far under the 600-character guard, which a unit test asserts for each question. A test also asserts that no benchmark complaint appears in either request. The safety path is untouched: the rules run before any model, the model is never offered CRITICAL, and a model answer of CRITICAL is refused.

## The measurement

ONE run of v2 on the primary provider, paced one request per second, in a seeded shuffle (seed 42) so a partial run is a fair sample. **It was stopped by the provider's rate limit (429) at item 33: 32 of 200 items were completed** (36 requests, the last four being the retries after the 429). It was not rerun: the rule allows exactly one run. A later attempt to complete it was blocked: the primary answered 429 to every check request (`classifier-benchmark.md`, "The full run could not be repeated"). v1 is evaluated on the same 32 items, from the committed v1 results. The fixture is `tests/fixtures/classifier-benchmark/results-v2.json`; `npm run classifier:benchmark -- --from-fixture` prints the comparison below with no network.

32 items are very few (6 to 10 per language group), so every rate has a wide interval and a single item moves a group by 10 points or more.

### Prompt v1 against v2 (32 items, the same items for both)

**Urgency** (the model's own answer, before the safety floor):

| Group | Items | v1 accepted | v1 accuracy among accepted | v1 D87 | v2 accepted | v2 accuracy among accepted | v2 D87 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ALL | 32 | 84.4% (27/32; 68.2%-93.1%) | 77.8% (21/27; 59.2%-89.4%) | FAIL | 56.3% (18/32; 39.3%-71.8%) | 55.6% (10/18; 33.7%-75.4%) | FAIL |
| EN | 6 | 83.3% (5/6; 43.6%-97.0%) | 80.0% (4/5; 37.6%-96.4%) | FAIL | 83.3% (5/6; 43.6%-97.0%) | 20.0% (1/5; 3.6%-62.4%) | FAIL |
| HI | 7 | 85.7% (6/7; 48.7%-97.4%) | 83.3% (5/6; 43.6%-97.0%) | FAIL | 42.9% (3/7; 15.8%-75.0%) | 33.3% (1/3; 6.1%-79.2%) | FAIL |
| MR | 10 | 80.0% (8/10; 49.0%-94.3%) | 75.0% (6/8; 40.9%-92.9%) | FAIL | 40.0% (4/10; 16.8%-68.7%) | 75.0% (3/4; 30.1%-95.4%) | FAIL |
| HINGLISH | 9 | 88.9% (8/9; 56.5%-98.0%) | 75.0% (6/8; 40.9%-92.9%) | FAIL | 66.7% (6/9; 35.4%-87.9%) | 83.3% (5/6; 43.6%-97.0%) | FAIL |

**Category:**

| Group | Items | v1 accepted | v1 accuracy among accepted | v1 D87 | v2 accepted | v2 accuracy among accepted | v2 D87 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ALL | 32 | 90.6% (29/32; 75.8%-96.8%) | 96.6% (28/29; 82.8%-99.4%) | PASS | 84.4% (27/32; 68.2%-93.1%) | 100.0% (27/27; 87.5%-100.0%) | PASS |
| EN | 6 | 100.0% (6/6; 61.0%-100.0%) | 100.0% (6/6; 61.0%-100.0%) | PASS | 100.0% (6/6; 61.0%-100.0%) | 100.0% (6/6; 61.0%-100.0%) | PASS |
| HI | 7 | 85.7% (6/7; 48.7%-97.4%) | 100.0% (6/6; 61.0%-100.0%) | PASS | 85.7% (6/7; 48.7%-97.4%) | 100.0% (6/6; 61.0%-100.0%) | PASS |
| MR | 10 | 80.0% (8/10; 49.0%-94.3%) | 100.0% (8/8; 67.6%-100.0%) | PASS | 80.0% (8/10; 49.0%-94.3%) | 100.0% (8/8; 67.6%-100.0%) | PASS |
| HINGLISH | 9 | 100.0% (9/9; 70.1%-100.0%) | 88.9% (8/9; 56.5%-98.0%) | FAIL | 77.8% (7/9; 45.3%-93.7%) | 100.0% (7/7; 64.6%-100.0%) | PASS |

**Urgency confusion** (truth: answers HIGH/NORMAL/LOW) and the share of errors that UNDER-rate urgency (true HIGH answered NORMAL or LOW, true NORMAL answered LOW):

| Group | v1 confusion | v1 under-rated | v2 confusion | v2 under-rated |
| --- | --- | --- | --- | --- |
| ALL | HIGH: 5/0/0; NORMAL: 3/12/3; LOW: 0/0/4 | 50.0% (3/6) | HIGH: 3/1/1; NORMAL: 0/4/6; LOW: 0/0/3 | 100.0% (8/8) |
| EN | HIGH: 3/0/0; NORMAL: 1/1/0; LOW: 0/0/0 | 0.0% (0/1) | HIGH: 1/1/1; NORMAL: 0/0/2; LOW: 0/0/0 | 100.0% (4/4) |
| HI | HIGH: 1/0/0; NORMAL: 0/4/1; LOW: 0/0/0 | 100.0% (1/1) | HIGH: 1/0/0; NORMAL: 0/0/2; LOW: 0/0/0 | 100.0% (2/2) |
| MR | HIGH: 1/0/0; NORMAL: 1/5/1; LOW: 0/0/0 | 50.0% (1/2) | HIGH: 1/0/0; NORMAL: 0/2/1; LOW: 0/0/0 | 100.0% (1/1) |
| HINGLISH | HIGH: 0/0/0; NORMAL: 1/2/1; LOW: 0/0/4 | 50.0% (1/2) | HIGH: 0/0/0; NORMAL: 0/2/1; LOW: 0/0/3 | 100.0% (1/1) |

**The pre-registered rule.** Adopt v2 only if ALL hold on the items measured: (a) overall urgency accuracy among accepted rises by at least 5 percentage points over v1, OR v2 passes the D87 urgency bar in at least two more language groups than v1; (b) urgency accepted share stays at least 50 percent; (c) category accuracy among accepted falls by no more than 2 percentage points in ANY group and category accepted share by no more than 5 points.

| Clause | Holds | Measured |
| --- | --- | --- |
| (a) | no | overall urgency accuracy among accepted changed by -22.2 points; groups passing the D87 urgency bar: v1 0, v2 0 |
| (b) | yes | urgency accepted share of v2: 56.3% |
| (c) | no | largest fall in category accuracy among accepted: 0.0 points; largest fall in category accepted share: 22.2 points |

**Outcome: v2 is NOT adopted; v1 stays the default.**

## The outcome

**v2 is NOT adopted; v1 stays the default.** Clause (a) failed: urgency accuracy among accepted FELL by 22.2 points (77.8% to 55.6%) and no group passes the urgency bar in either version. Clause (c) failed: the category accepted share fell by 22.2 points in one group (the Hinglish group, 9 items: 9 accepted for v1, 7 for v2). Clause (b) held (urgency accepted 56.3%). Worse than not helping, v2 pushed more answers below the 0.60 acceptance threshold (urgency accepted share 84.4% to 56.3%) and its errors were all in the dangerous direction: 8 of 8 urgency errors under-rated urgency (v1: 3 of 6). The reading of 32 items is weak evidence, but the rule was fixed before the run and is applied as written; no further prompt edit was made.

## The safety floor (D199)

Urgency fails the D87 bar in every language group in v1 (80.5% to 88.9% right among accepted, bar 90%) and v2 did not fix it, so the floor applies: **an accepted model urgency of LOW is stored as NORMAL.** The reason `URGENCY_FLOORED` is added to the decision, and the model's own answer (`modelUrgency: "LOW"`) is kept in the payload of the `CLASSIFIED` event (the classification row has no JSON column, so it is not changed). The keyword fallback and the safety rules are not floored; NORMAL and HIGH are unchanged; no CRITICAL can result. Why: under-rating urgency is the dangerous error. An over-rated complaint costs a staff member a look; an under-rated one (a water leak filed as "can wait several days") is answered late. The benchmark's numbers measure the model's own answer before the floor.
