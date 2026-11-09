# Classifier urgency errors

This page collects what the classifier benchmark says about urgency (HIGH, NORMAL, LOW). The data is the 200 SYNTHETIC complaints of `src/domain/complaints/classifier-benchmark`, answered once by the primary provider with prompt v1 (`tests/fixtures/classifier-benchmark/results.json`). Everything below is measured offline from that fixture; no request was sent.

## Could urgency be a same-day detector?

**The question.** Today urgency is one of three answers. Suppose it were one yes or no question instead: "does this complaint need action today?" We take the model's probability for HIGH as a score. A complaint is stored as HIGH when the score is at least a threshold t. The truth is the dataset's label: HIGH, or not HIGH. This is measurement only (D200). Production does not change and no threshold was added to the decision code.

Run `npm run classifier:benchmark -- --from-fixture` for every table (overall, per language group, all items, non-hard items and hard items). 198 of the 200 items have an answer; 2 had no answer from the provider and are left out. Of those 198, 39 are truly HIGH and 159 are not.

**What was measured** (overall, all items; the 95 percent Wilson interval of each recall is in the command output):

| Rule | Recall of true HIGH | Precision of HIGH | True NORMAL or LOW stored HIGH | True LOW stored HIGH |
|---|---|---|---|---|
| production today | 97.4% (38/39) | 76.0% (38/50) | 7.5% (12/159) | 0/40 |
| t = 0.10 | 100% (39/39) | 37.9% (39/103) | 40.3% (64/159) | 0/40 |
| t = 0.30 | 100% (39/39) | 54.9% (39/71) | 20.1% (32/159) | 0/40 |
| t = 0.60 | 100% (39/39) | 72.2% (39/54) | 9.4% (15/159) | 0/40 |

- Recall is 100% at EVERY threshold from 0.10 to 0.60 (the Wilson interval is 91.0% to 100%). The model's answers are close to 0 or 1, so moving the threshold changes how many ordinary complaints are over-rated, not how many urgent ones are caught. Lowering the threshold only costs: at 0.10 about 4 in 10 ordinary complaints would be stored HIGH.
- The one true HIGH that production misses is `MR-ELECTRICAL-02`. Its P(HIGH) is 0.83. Production misses it because the category answer (ELECTRICAL 0.63) is under 0.70, so the whole answer is refused and the urgency is not taken from the model. A rule that reads P(HIGH) on its own catches it at every threshold up to 0.60. So the gain in this data comes from reading urgency separately from category, not from a lower threshold.
- Over-rating at t = 0.60 (9.4%) is a little above production (7.5%), because production also drops a HIGH answer when the category is refused.
- The hard items are where a detector is wrong: at t = 0.60, 11 of the 20 hard items that are not HIGH are stored HIGH (55%), against 4 of the 139 non-hard ones (2.9%). Recall is still 100% on both kinds.

**Held-out numbers (leave-one-group-out).** For each language group the threshold was chosen on the other three groups: the largest t whose recall of true HIGH there is at least 0.90 (if none reaches it, the highest recall). It was then applied to the held-out group.

| Held-out group | Chosen t | Held-out recall of true HIGH | Held-out over-rated |
|---|---|---|---|
| EN | 0.60 | 100% (10/10) | 12.5% (5/40) |
| HI | 0.60 | 100% (9/9) | 7.5% (3/40) |
| MR | 0.60 | 100% (10/10) | 10.0% (4/40) |
| HINGLISH | 0.60 | 100% (10/10) | 7.7% (3/39) |
| all four | 0.60 | 100% (39/39) | 9.4% (15/159) |

The chosen threshold is 0.60 in all four folds, a spread of 0.00. That is because recall already reaches 100% at the top of the grid, so "the largest t that reaches 0.90" is the top of the grid every time. It says the grid is too narrow to find a limit, not that 0.60 is special. The selection used the benchmark itself, so the held-out numbers are optimistic.

**What the numbers do NOT show.**

- There are only 40 true HIGH items (39 with an answer). The lowest the recall could truly be is about 91% (the interval), and 10 per language group is far too few to compare groups.
- The data is synthetic: written by the coding agent, not reviewed by a native speaker. Real complaints are messier and the model's probabilities may not sit so close to 0 and 1.
- The labels are the author's judgement, not a resident's or a duty manager's.
- The threshold was chosen on the same data it is scored on. Leave-one-group-out removes one group from the choice but not the author's habits from the data.
- Urgent words and safety words still work by rule before any of this and are not tested here.

**For the human to decide:** whether a yes or no detector that reads P(HIGH) separately from the category answer is worth a pre-registered live test on real complaints (the open question is whether the one catch seen here, a HIGH lost to a refused category, happens on real text).
