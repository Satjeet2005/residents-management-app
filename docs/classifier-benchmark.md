# Classifier benchmark (D86, D87)

**What this is.** A measurement of the complaint classifier on 200 SYNTHETIC complaints. It is not a measurement on real residents. Read "The limits" before quoting any number.

## Method, in plain words

1. The dataset is 200 made-up complaints: 5 categories x 4 language groups (English, Hindi, Marathi, Hinglish) x 10. It is in `src/domain/complaints/classifier-benchmark/` with its own README.
2. Each complaint was sent once to a provider through the app's own client and request builder (`npm run classifier:benchmark`). The answer is two lists of probabilities: one over the five categories, one over HIGH, NORMAL and LOW.
3. The answers are judged by the SAME rule the app uses (`decideClassification`, one answer allowed, category at least 0.70, urgency at least 0.60). An answer under the bar is "not accepted": in the app it falls back to the keywords or goes to a person.
4. Three arms are compared: **Jev** alone, the **keyword** baseline alone (the app's fallback), and **production** (Jev if accepted, else the keywords, else a person).
5. The bar was fixed in advance (D87): at least 90% correct among the accepted, and at least 60% accepted, in each language group. A group that meets both is PASS. Every rate has a 95% Wilson interval.
6. Urgency is reported apart from category.

## The limits

- The data is synthetic. It was written by the coding agent, not reviewed by a native speaker, and the labels are the author's judgement.
- There are only 10 items per cell and 50 per language group, so the intervals are wide.
- The complaints were written with clear everyday words. The keyword baseline did well on them for that reason. Real complaints are messier, and real text may be shorter, misspelt or mixed.
- The model may have seen similar sentences.
- Safety complaints are not in the set. They never go to a model; the safety rules decide them first.

## Procedure and request counts

- Primary provider: all 200 items, 200 requests, one request per second.
- Secondary provider: a sample of 60 items (3 per cell, seed 42), 60 requests.
- Nothing was retried except after a 429 (none happened). The hard cap is 250 requests per provider per run. Every answer is cached in `.cache/classifier-benchmark/` so a rerun sends nothing it already has.
- The compact results are committed in `tests/fixtures/classifier-benchmark/results.json` (no address, no key, no complaint text). `npm run classifier:benchmark -- --from-fixture` recomputes everything below from that file with no network, and a test checks that the block below is exactly its output.

## Results

<!-- RESULTS:START -->
### primary (200 items)

**Jev, category** (accepted by the production rule, then accuracy among the accepted):

| Group | Items | Accepted | Accuracy among accepted | D87 |
| --- | --- | --- | --- | --- |
| ALL | 200 | 92.5% (185/200; 88.0%-95.4%) | 99.5% (184/185; 97.0%-99.9%) | PASS |
| EN | 50 | 94.0% (47/50; 83.8%-97.9%) | 100.0% (47/47; 92.4%-100.0%) | PASS |
| HI | 50 | 92.0% (46/50; 81.2%-96.8%) | 100.0% (46/46; 92.3%-100.0%) | PASS |
| MR | 50 | 88.0% (44/50; 76.2%-94.4%) | 100.0% (44/44; 92.0%-100.0%) | PASS |
| HINGLISH | 50 | 96.0% (48/50; 86.5%-98.9%) | 97.9% (47/48; 89.1%-99.6%) | PASS |

**Jev, urgency** (reported apart; an urgency under 0.60 is not accepted):

| Group | Items | Accepted | Accuracy among accepted | D87 |
| --- | --- | --- | --- | --- |
| ALL | 200 | 83.0% (166/200; 77.2%-87.6%) | 85.5% (142/166; 79.4%-90.1%) | FAIL |
| EN | 50 | 82.0% (41/50; 69.2%-90.2%) | 80.5% (33/41; 66.0%-89.8%) | FAIL |
| HI | 50 | 80.0% (40/50; 67.0%-88.8%) | 87.5% (35/40; 73.9%-94.5%) | FAIL |
| MR | 50 | 80.0% (40/50; 67.0%-88.8%) | 85.0% (34/40; 70.9%-92.9%) | FAIL |
| HINGLISH | 50 | 90.0% (45/50; 78.6%-95.7%) | 88.9% (40/45; 76.5%-95.2%) | FAIL |

**Keyword baseline, category** (the production fallback):

| Group | Items | Accepted | Accuracy among accepted | D87 |
| --- | --- | --- | --- | --- |
| ALL | 200 | 77.5% (155/200; 71.2%-82.7%) | 92.3% (143/155; 87.0%-95.5%) | PASS |
| EN | 50 | 76.0% (38/50; 62.6%-85.7%) | 94.7% (36/38; 82.7%-98.5%) | PASS |
| HI | 50 | 76.0% (38/50; 62.6%-85.7%) | 92.1% (35/38; 79.2%-97.3%) | PASS |
| MR | 50 | 78.0% (39/50; 64.8%-87.2%) | 89.7% (35/39; 76.4%-95.9%) | FAIL |
| HINGLISH | 50 | 80.0% (40/50; 67.0%-88.8%) | 92.5% (37/40; 80.1%-97.4%) | PASS |

**Production** (Jev if accepted, else the keywords, else a person):

| Group | Items | Classified automatically | Accuracy among those | Sent to a person | D87 |
| --- | --- | --- | --- | --- | --- |
| ALL | 200 | 98.5% (197/200; 95.7%-99.5%) | 97.5% (192/197; 94.2%-98.9%) | 1.5% (3/200; 0.5%-4.3%) | PASS |
| EN | 50 | 100.0% (50/50; 92.9%-100.0%) | 98.0% (49/50; 89.5%-99.6%) | 0.0% (0/50; 0.0%-7.1%) | PASS |
| HI | 50 | 98.0% (49/50; 89.5%-99.6%) | 98.0% (48/49; 89.3%-99.6%) | 2.0% (1/50; 0.4%-10.5%) | PASS |
| MR | 50 | 96.0% (48/50; 86.5%-98.9%) | 95.8% (46/48; 86.0%-98.8%) | 4.0% (2/50; 1.1%-13.5%) | PASS |
| HINGLISH | 50 | 100.0% (50/50; 92.9%-100.0%) | 98.0% (49/50; 89.5%-99.6%) | 0.0% (0/50; 0.0%-7.1%) | PASS |

Both category and urgency accepted: 83.0% (166/200; 77.2%-87.6%).

**Confusion, Jev** (rows are the truth, columns the answer; accepted answers only):

| Truth \ answered | PLUMBING | ELECTRICAL | HOUSEKEEPING | LIFT | OTHER |
| --- | --- | --- | --- | --- | --- |
| PLUMBING | 39 | 0 | 0 | 0 | 0 |
| ELECTRICAL | 0 | 38 | 0 | 0 | 0 |
| HOUSEKEEPING | 0 | 0 | 37 | 0 | 0 |
| LIFT | 0 | 1 | 0 | 32 | 0 |
| OTHER | 0 | 0 | 0 | 0 | 38 |

**Confusion, keywords:**

| Truth \ answered | PLUMBING | ELECTRICAL | HOUSEKEEPING | LIFT | OTHER |
| --- | --- | --- | --- | --- | --- |
| PLUMBING | 38 | 0 | 1 | 0 | 0 |
| ELECTRICAL | 0 | 28 | 0 | 0 | 1 |
| HOUSEKEEPING | 3 | 0 | 22 | 0 | 0 |
| LIFT | 0 | 4 | 0 | 34 | 0 |
| OTHER | 0 | 0 | 3 | 0 | 21 |

**Confusion, production:**

| Truth \ answered | PLUMBING | ELECTRICAL | HOUSEKEEPING | LIFT | OTHER |
| --- | --- | --- | --- | --- | --- |
| PLUMBING | 40 | 0 | 0 | 0 | 0 |
| ELECTRICAL | 0 | 40 | 0 | 0 | 0 |
| HOUSEKEEPING | 1 | 0 | 38 | 0 | 0 |
| LIFT | 0 | 4 | 0 | 36 | 0 |
| OTHER | 0 | 0 | 0 | 0 | 38 |

**The 1 most confident wrong answers of Jev** (accepted, and wrong):

| Item | Truth | Answered | Probability | Text |
| --- | --- | --- | --- | --- |
| HINGLISH-LIFT-06 | LIFT | ELECTRICAL | 0.73 | Lift ki light jhilmilati hai aur andar ka fan bhi band hai, shayad koi electrical issue hai. |

Latency of the answers: p50 530 ms, p95 975 ms. Availability (answers over attempts): 99.0% (198/200; 96.4%-99.7%).

### secondary (60 items)

**Jev, category** (accepted by the production rule, then accuracy among the accepted):

| Group | Items | Accepted | Accuracy among accepted | D87 |
| --- | --- | --- | --- | --- |
| ALL | 60 | 0.0% (0/60; 0.0%-6.0%) | no items | FAIL |
| EN | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |
| HI | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |
| MR | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |
| HINGLISH | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |

**Jev, urgency** (reported apart; an urgency under 0.60 is not accepted):

| Group | Items | Accepted | Accuracy among accepted | D87 |
| --- | --- | --- | --- | --- |
| ALL | 60 | 0.0% (0/60; 0.0%-6.0%) | no items | FAIL |
| EN | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |
| HI | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |
| MR | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |
| HINGLISH | 15 | 0.0% (0/15; 0.0%-20.4%) | no items | FAIL |

**Keyword baseline, category** (the production fallback):

| Group | Items | Accepted | Accuracy among accepted | D87 |
| --- | --- | --- | --- | --- |
| ALL | 60 | 85.0% (51/60; 73.9%-91.9%) | 94.1% (48/51; 84.1%-98.0%) | PASS |
| EN | 15 | 86.7% (13/15; 62.1%-96.3%) | 100.0% (13/13; 77.2%-100.0%) | PASS |
| HI | 15 | 93.3% (14/15; 70.2%-98.8%) | 100.0% (14/14; 78.5%-100.0%) | PASS |
| MR | 15 | 73.3% (11/15; 48.0%-89.1%) | 81.8% (9/11; 52.3%-94.9%) | FAIL |
| HINGLISH | 15 | 86.7% (13/15; 62.1%-96.3%) | 92.3% (12/13; 66.7%-98.6%) | PASS |

**Production** (Jev if accepted, else the keywords, else a person):

| Group | Items | Classified automatically | Accuracy among those | Sent to a person | D87 |
| --- | --- | --- | --- | --- | --- |
| ALL | 60 | 85.0% (51/60; 73.9%-91.9%) | 94.1% (48/51; 84.1%-98.0%) | 15.0% (9/60; 8.1%-26.1%) | PASS |
| EN | 15 | 86.7% (13/15; 62.1%-96.3%) | 100.0% (13/13; 77.2%-100.0%) | 13.3% (2/15; 3.7%-37.9%) | PASS |
| HI | 15 | 93.3% (14/15; 70.2%-98.8%) | 100.0% (14/14; 78.5%-100.0%) | 6.7% (1/15; 1.2%-29.8%) | PASS |
| MR | 15 | 73.3% (11/15; 48.0%-89.1%) | 81.8% (9/11; 52.3%-94.9%) | 26.7% (4/15; 10.9%-52.0%) | FAIL |
| HINGLISH | 15 | 86.7% (13/15; 62.1%-96.3%) | 92.3% (12/13; 66.7%-98.6%) | 13.3% (2/15; 3.7%-37.9%) | PASS |

Both category and urgency accepted: 0.0% (0/60; 0.0%-6.0%).

**Confusion, Jev** (rows are the truth, columns the answer; accepted answers only):

| Truth \ answered | PLUMBING | ELECTRICAL | HOUSEKEEPING | LIFT | OTHER |
| --- | --- | --- | --- | --- | --- |
| PLUMBING | 0 | 0 | 0 | 0 | 0 |
| ELECTRICAL | 0 | 0 | 0 | 0 | 0 |
| HOUSEKEEPING | 0 | 0 | 0 | 0 | 0 |
| LIFT | 0 | 0 | 0 | 0 | 0 |
| OTHER | 0 | 0 | 0 | 0 | 0 |

**Confusion, keywords:**

| Truth \ answered | PLUMBING | ELECTRICAL | HOUSEKEEPING | LIFT | OTHER |
| --- | --- | --- | --- | --- | --- |
| PLUMBING | 12 | 0 | 0 | 0 | 0 |
| ELECTRICAL | 0 | 11 | 0 | 0 | 0 |
| HOUSEKEEPING | 1 | 0 | 8 | 0 | 0 |
| LIFT | 0 | 1 | 0 | 10 | 0 |
| OTHER | 0 | 0 | 1 | 0 | 7 |

**Confusion, production:**

| Truth \ answered | PLUMBING | ELECTRICAL | HOUSEKEEPING | LIFT | OTHER |
| --- | --- | --- | --- | --- | --- |
| PLUMBING | 12 | 0 | 0 | 0 | 0 |
| ELECTRICAL | 0 | 11 | 0 | 0 | 0 |
| HOUSEKEEPING | 1 | 0 | 8 | 0 | 0 |
| LIFT | 0 | 1 | 0 | 10 | 0 |
| OTHER | 0 | 0 | 1 | 0 | 7 |

**The 0 most confident wrong answers of Jev** (accepted, and wrong):

None.

Latency of the answers: p50 n/a ms, p95 n/a ms. Availability (answers over attempts): 0.0% (0/60; 0.0%-6.0%).
<!-- RESULTS:END -->

## In plain words

- **Primary provider.** On this synthetic set it accepted 92.5% of complaints (185 of 200) and was right on 99.5% of those it accepted (184 of 185). Every language group passes the D87 bar on category. Marathi is the lowest on the share accepted (88.0%). The only accepted mistake is a Hinglish complaint about a lift light and fan that said "electrical issue" (answered ELECTRICAL at 0.73; the truth is LIFT).
- **Urgency is weaker.** Of the answers accepted, 80.5% to 88.9% had the right urgency, and every group is under the 90% bar. Urgency should not be trusted without a person.
- **Keywords alone** were right on 92.3% of the 77.5% they classify. Marathi fails the bar for keywords (89.7%). Keywords and Jev together (production) classified 98.5% and were right on 97.5% of those.
- **Speed and reliability.** The typical answer took 530 ms (95% under 975 ms). 198 of 200 requests were answered; two timed out at the 3-second limit.
- **Secondary provider.** It could not be measured. All 60 requests failed: 54 were refused with a 400 status, 4 timed out and 2 had no network answer. This is why there are no numbers for it. The cause was not investigated: the app never logs what was sent or received, and this run did not change that.
- **The dry run proves the code path, not accuracy.** The local fake provider used for tests says nothing about a real model.

## Recommendation (for the human to approve; nothing was changed)

1. Keep the production gating as it is. The thresholds (0.70 and 0.60) and the order (first provider, then second, then keywords) were not changed by this work.
2. On this synthetic evidence the primary provider could be enabled for all four language groups. Before trusting that for Hindi and Marathi, have a native speaker review a sample of real, de-identified complaints, and run this benchmark again on them.
3. Do not rely on the model's urgency. Keep the keyword urgency words and the person in the loop.
4. Find out why the secondary provider refuses the request (a 400 for every item) before counting on it as a second source.

Awaiting approval: not applied.
