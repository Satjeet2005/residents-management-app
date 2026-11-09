# Jev integration: what is built, the live proof, and how to run it

The complaint classifier can ask two language-model providers (called "primary" and "secondary" here) which category and urgency a complaint has. This page says where that is in the code, how it behaves, what was proved live, and what was measured. The decisions behind it are D86, D87, D88, D117, D118, D119 and D140 to D145. The measurement is in [`classifier-benchmark.md`](classifier-benchmark.md); the provider details are in [`classifier-providers.md`](classifier-providers.md).

## Where it is

| What | File |
|---|---|
| Settings read from the environment | `src/server/complaints/providers/config.ts` |
| The request builder and the answer check | `src/server/complaints/providers/system-one.ts` |
| One request, with a timeout and no retry | `src/server/complaints/providers/client.ts` |
| Circuit breaker and daily cap | `breaker.ts`, `cap.ts` in the same folder |
| First provider, then the second | `classifier-jev.ts` |
| The default the app uses | `productionClassifier()` in `factory.ts` |
| The rules that accept or refuse an answer | `src/domain/complaints/decision.ts` |
| The keyword fallback | `src/domain/complaints/fallback.ts` |

## The flow, in plain words

1. A resident writes a complaint. The safety rules read the RAW text first. A safety word, or the resident answering "yes" to the danger question, makes the complaint CRITICAL and sends it to the duty manager. In that case NO provider is called.
2. Otherwise the text is de-identified (phone numbers, e-mail addresses, web addresses, flat codes and known names are replaced) and goes to the first provider, then the second, inside a 4-second budget.
3. The answer is checked. It must be a valid list of probabilities for exactly the five categories and for HIGH, NORMAL and LOW. The category must be at least 0.70 and the urgency at least 0.60 to be accepted. A model can NEVER give CRITICAL.
4. If no provider answers, or the answer is invalid or too unsure, the keyword fallback classifies it, or the complaint goes to a person.
5. One row is stored with the source: RULE, LLM, FALLBACK or NONE (MANUAL when a person changes it).

## Settings (names only)

| Name | What it does |
|---|---|
| `JEV_PRIMARY_URL`, `JEV_PRIMARY_KEY` | The first provider. Both are needed. |
| `JEV_PRIMARY_MODEL` | Optional. Left out, the provider uses its default. |
| `JEV_SECONDARY_URL`, `JEV_SECONDARY_KEY`, `JEV_SECONDARY_MODEL` | The same for the second provider. |
| `JEV_TIMEOUT_MS` | The longest one request may take. |
| `JEV_DAILY_CAP` | The most requests one provider gets in a business day. |
| `JEV_BREAKER_FAILURES`, `JEV_BREAKER_COOLDOWN_SECONDS` | How many failures open the breaker, and for how long. |

A wrong setting never blocks a complaint: that provider is skipped and the name of the setting (never its value) is warned once.

## When something goes wrong

| What happens | What the app does |
|---|---|
| A timeout or no network answer | Tries the second provider, then the keywords. Counts as a failure for the breaker. |
| A 429 (too many requests) | Not retried. Tries the second provider, then the keywords. |
| A 401 or 403 (a key or account problem) | Opens that provider's breaker at once and records a warning. |
| An answer that is not valid | Treated as no answer. |
| A model says CRITICAL | The answer is refused. Only the safety rules produce CRITICAL. |

## Privacy

- Only de-identified text leaves the server. The request holds the model name, the text and the questions: no user id and no flat.
- Nothing about a request or an answer is logged, and the provider's name is stored nowhere. A safety complaint never reaches a provider.

## The live proof, run on 2026-11-09

**1. Connection check (`npm run llm:check`)**, three fixed fictional sentences per provider:

| Provider | Result |
|---|---|
| Primary | Three answers, status 200, 915, 600 and 408 ms. Categories PLUMBING, ELECTRICAL and HOUSEKEEPING, each at 1.00. Urgency HIGH 0.94, NORMAL 0.63 and NORMAL 0.67. |
| Secondary | No answer: two timeouts at about 3 seconds and one network failure. |

**2. Through the real service (`npm run jev:e2e`)**: eight complaints raised as the seeded resident Swati Joshi through `createComplaint`, on a scratch database that the script creates and drops. It counts the requests the app makes and prints no address or key.

```
id  language  source    category      urgency   conf  review  requests  ms
a   English   LLM       PLUMBING      HIGH      1.00  false   1         819
b   English   LLM       ELECTRICAL    NORMAL    1.00  false   1         540
c   Hinglish  LLM       LIFT          NORMAL    1.00  false   1         609
d   Hindi     LLM       HOUSEKEEPING  NORMAL    1.00  false   1         876
e   Marathi   LLM       PLUMBING      NORMAL    1.00  false   1         391
f   English   LLM       OTHER         NORMAL    1.00  false   1         376
g   English   RULE      LIFT          CRITICAL  -     false   0         17
h   English   RULE      -             CRITICAL  -     true    0         14
```

Both safety cases (g: "I can smell gas near the lift lobby", h: a declared danger) were decided by the rule with zero provider requests. Each of the six ordinary complaints made one request and was classified by the model. The scratch database was dropped.

**Not checked live:** the script does not read the provider keys, so it does not scan the stored rows for them. That is covered by the unit tests in `tests/server/complaints/providers/privacy.test.ts`, which check requests and logs, not by this run.

## The second provider's 400 (investigated 2026-11-09)

Six requests were sent to the secondary provider (five with the configured model, one with the model left out). Every one answered HTTP 400 with the body `{"code":-1,"message":"INVALID_JEV_REQUEST"}`. Leaving the model out changed nothing. The message does not say which field is wrong, and its docs are not available (the operator is unverified, D140), so **the cause is not known and was not guessed at**: it could be the request shape, a model name the account does not have or a protocol that differs from the primary's. No change was made to the request builder for the secondary. Earlier, 4 of the 60 benchmark requests timed out and 2 had no network answer; the rest were the same 400.

**In practice the chain is the primary provider plus the keyword fallback:** the secondary is tried only when the primary fails or is skipped, answers 400 every time, and counts as a failure for its breaker. Next step for a human: ask the operator, or read the provider's real API description, for the request it expects.

## The prompt

The request text and a reviewed v2 are in [`jev-prompt.md`](jev-prompt.md). v1 stays the default (`CLASSIFIER_PROMPT_VERSION`). An accepted model urgency of LOW is stored as NORMAL (D199).

## The benchmark

200 synthetic complaints, measured on 2026-11-09. See [`classifier-benchmark.md`](classifier-benchmark.md). In short: the primary provider was accepted on 92.5% and right on 99.5% of those on synthetic data, every language group passes the 90% and 60% bar on category, and urgency does not. The secondary provider refused every benchmark request, so it has no numbers. The text there says what the data cannot show.

## How to rotate a key, or turn it off

- Rotate: set the new value for the `JEV_*_KEY` name in the Vercel dashboard only (Production), redeploy, then run `npm run llm:check` on your own machine to see a status line for each provider. Never paste a key into a file, a chat or a commit.
- Turn off: unset the `JEV_*` names in Vercel and redeploy. Complaints are then classified by the keywords and a person.

## Caveats

- Both are free or limited tiers and may rate-limit.
- The operator of the second endpoint is unverified (D140). Only de-identified text is ever sent to it.
