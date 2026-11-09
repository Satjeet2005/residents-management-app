# Classifier providers (T13d)

How a complaint can be classified by a language model, server side only. Decisions: D140 (the provider chain), D141 (breaker and daily cap in memory), D142
(a 401 or 403 opens the breaker), D144 (the model name is optional), D145 (a bad setting never blocks a complaint), with D9, D73, D88, D118 and D119. Assumptions: R50 to R65 (`docs/assumptions.md`). Code: `src/server/complaints/providers/`.
The ports and rules around it are in `docs/complaints-design.md` and `docs/complaint-classification.md`.
The live proof, the end-to-end script and the benchmark are in [`jev-integration.md`](jev-integration.md) and [`classifier-benchmark.md`](classifier-benchmark.md).

## The chain

1. The safety rules read the raw text first. A hit, or a declared danger, never reaches a provider (D119): the integration test PV9 asserts zero requests.
2. Otherwise the DE-IDENTIFIED text (D88) goes to the primary provider, **OpenCode**; if it is skipped or fails, to the secondary, **jevmodel.app**; then
   `null`, and the keyword fallback runs. One attempt per provider per complaint; nothing is retried.
3. `decideClassification` (T10a) decides what to do with the answer. The classifier can never return CRITICAL: the urgency question has only HIGH, NORMAL and
   LOW, and an answer that names CRITICAL is refused (by the parser here, and again by the domain's rule R2).
4. With no provider configured, `NullClassifier` is used and every complaint takes the keyword fallback, as before.

## The protocol, as documented

Source: TypeSafe's System One API reference, read on **2026-11-07**. The pages are Markdown at `https://docs.typesafe.ai/<page>.md`; the index is
`https://docs.typesafe.ai/llms.txt`, and `https://docs.typesafe.ai/api` redirects to `.../api/system-one.md` (OpenAPI at `https://api.typesafe.ai/openapi.json`).
Pages used: `api/system-one`, `api/errors`, `primitives/choice`, `models`.

| Item | What the documentation says |
|---|---|
| Request | `POST /v1/systemone`, JSON: `model` (string), `state` (string, object or array: the content the questions are about), `questions` (a map from a name you choose to a question; at least one). |
| Choice question | `{ "type": "choice", "instructions": "...", "criteria": { "<option>": "<when it applies>", ... } }` (1 to 255 options; the model never sees the question name, but sees the option names and descriptions). |
| Other types | `noul` (`instructions`; the answer is `noul`, a probability of yes), `score` (`criteria` an ordered list of levels; the answer has `score`, `confidence`, `legend`, `probabilities`), `box` (images only). This app uses two `choice` questions only. |
| Response | `{ "model", "answers": { "<name>": { "type": "choice", "choice": "<top option>", "confidence": 0..1, "probabilities": { "<option>": p, ... } } }, "usage": { "input_tokens", "output_tokens" } }`. The probabilities cover every option and **sum to 1**, which is why this app rejects, and never renormalises, an answer that does not. |
| Authentication | `Authorization: Bearer <API key>`. |
| Models | `jev-1.14.0`, `jev-1.13.0`; aliases `jev-latest` (the default in the documentation's examples) and `jev-preview` (the same model today). |
| Limits | Context 64k tokens per request and 32k per question (a long-context header raises it; this app does not use it). A body of at most 32 MiB, UTF-8 JSON. Rate limits are per organisation, in tokens and requests per second; the limit is set in the provider's console. |
| Errors | 400 (a request rule, or the request is longer than the context), 401 (missing or invalid key), 413, 415, 422 (validation), 429 (rate limit: retry later), 529 (overloaded). |

The request this app sends (`buildRequest`): `model` (only when the human set one: without it the field is left out and the provider chooses, D144), `state` (the de-identified text) and two choice questions: `category` over PLUMBING, ELECTRICAL,
HOUSEKEEPING, LIFT, OTHER, and `urgency` over HIGH, NORMAL, LOW, each with plain-language instructions and a description per option. Nothing else: no user id,
no flat, no complaint id. The fixtures in `tests/fixtures/system-one/` are the documentation's example bodies (labelled with their source and date) and one body
in the documented shape with this app's labels.

## The two providers, and what is and is not verified

| | Primary: OpenCode | Secondary: jevmodel.app |
|---|---|---|
| Address the human uses | `https://opencode.ai/inference/systemone/v1/systemone` | `https://jevmodel.app/api/v1/systemone` |
| Tier | Free, may rate-limit | Limited free tier |
| What was found (2026-11-07) | OpenCode's inference documentation (`opencode.ai/v2/docs/console/inference/`) and its live model list (`opencode.ai/inference/v1/models`, 81 models) describe OpenAI-, Anthropic- and Gemini-compatible endpoints. **Neither mentions System One, Jev or TypeSafe**, and no model in the list uses such an endpoint. An unauthenticated GET of the address above returns 404 (expected for a POST-only route, but it proves nothing). | The address returns a web page titled "JevModel" (a single-page app) with no API documentation; automated access was not refused, but nothing about the protocol could be read. The operator is **not verified**. |
| What is assumed | The same protocol as TypeSafe's (R50). The model name, if the account needs one, is set in `JEV_PRIMARY_MODEL`; otherwise the provider's default is used (D144). | The same protocol (R51). Only de-identified text goes there. |
| Documented limits | None found. | None found. |

Nothing in this task was sent to either provider: no key was available to the agent and no test uses the real network. `npm run llm:check` is how the human
finds out whether each provider really answers in this shape. If a provider differs, the symptom is an `INVALID` failure and the keyword fallback.

## Configuration

Names only, in `.env.example`; values in the human's own `.env` and in the Vercel dashboard, never anywhere else (`docs/deployment-plan.md`).

| Variable | Meaning | Default and range |
|---|---|---|
| `JEV_PRIMARY_URL`, `JEV_PRIMARY_KEY`, `JEV_PRIMARY_MODEL` | OpenCode. The URL and the key are needed, or the provider is not configured. The model is OPTIONAL (D144): unset, the request has no `model` field. Set, it is 1 to 80 characters of letters, digits and `. - _ / :`; anything else leaves out THAT provider (reason `BAD_MODEL`) and the variable name is logged once, never the value. | URL must be https (http only for 127.0.0.1 and localhost, for tests); no credentials in it |
| `JEV_SECONDARY_URL`, `JEV_SECONDARY_KEY`, `JEV_SECONDARY_MODEL` | jevmodel.app, same rules. | |
| `JEV_TIMEOUT_MS` | The most one request may take. | 3000; 500 to 4000 |
| `JEV_DAILY_CAP` | Calls per provider per India day. | 300; 1 to 100000 |
| `JEV_BREAKER_FAILURES` | Failures in a row before the breaker opens. | 3; 1 to 20 |
| `JEV_BREAKER_COOLDOWN_SECONDS` | How long it stays open. | 120; 1 to 3600 |

**A bad setting never blocks a complaint (D145).** `createClassifierFromEnv` and `productionClassifier` never throw, whatever the environment holds. Each provider is
judged on its own: one whose URL is not https (or is not a URL, or is over 2,048 characters, or holds credentials), whose key or URL is missing while the other is set, or
whose model name is invalid is SKIPPED and the other still answers. A shared number that is invalid (timeout, daily cap, breaker) falls back to its default. Each bad
variable is warned ONCE per classifier, so once per server instance, as `classifier setting invalid: JEV_PRIMARY_URL`: the variable name only, never a value, a URL, a
key or a length. `describeProviders(env)` reports every setting without a value: each provider is `configured`, `not_configured` or `invalid` with a fixed reason
(`URL_INVALID`, `URL_NOT_HTTPS`, `URL_HAS_CREDENTIALS`, `MISSING_URL`, `MISSING_KEY`, `BAD_MODEL`), and the shared timeout, cap and breaker are `default`, `set` or
`invalid_using_default`. `createClassifierFromEnv` returns a `JevClassifier` when at
least one provider is configured and `NullClassifier` otherwise; the complaint handler builds one per server instance (`productionClassifier`) and tests inject fakes.

## Failover, time and the breaker

- **Order and time.** The primary is always first. The caller's budget (4,000 ms, D118) is passed down: a request gets at most the call timeout and at most an equal
  share of the time left among the providers still available, and is tied to the caller's signal, so it is aborted when the budget ends. A test with two hanging
  providers and a 600 ms budget finishes inside it and sees both connections dropped (PV7).
- **Breaker (per provider).** Closed; after N failures in a row it opens for the cooldown (the provider is skipped, silently); then half-open with ONE trial request:
  a success closes it, a failure opens it again for a full cooldown. A timeout, a 5xx, an invalid or oversized answer, a redirect and a network error are failures.
- **Status mapping.** 2xx: parse. 401 or 403: a configuration failure, the breaker opens at once, logged once per cooldown (D142). 429: the breaker opens for
  `Retry-After` seconds, at most the cooldown. 5xx and network errors: failures. Any other 4xx: a failure (R57). A redirect is never followed. At most 64 KB of a
  response is read.
- **Daily cap.** At most `JEV_DAILY_CAP` calls a day per provider; at midnight India time (the business clock) the count restarts. At the cap the provider is skipped.

## Serverless limits (D141)

The breaker and the cap are in module memory. On Vercel each function instance has its own, a cold start resets them, and instances do not share them. So the
real number of calls in a day can be up to the cap times the number of instances, and a bad key may be found once per instance. This is acceptable for a free tier
and a demo; a shared store (a database row, or a cache) would be a new decision and, for a cache, a new dependency.

## Privacy

- Only the de-identified text is sent (D88). De-identification reduces personal data; it does not remove all of it (`docs/complaint-classification.md`).
- The request body is only the model (when set), the text and the questions. A test compares it byte for byte with `buildRequest(text, model)`; another checks the exact keys with and without a model.
- The key goes only in the `Authorization` header, from the environment; it is never logged or put in an error message.
- Logging is two fixed sentences: `classifier provider failed: provider=<name> failure=<KIND> status=<code> latency_ms=<n>`, and, when a setting is bad, `classifier setting invalid: <VARIABLE NAME>` (D145). A test captures every console method after
  every kind of failure and checks that it holds no key, no complaint text, no URL, no query and no response body.
- The provider's NAME is not stored with the classification (R58).

## Running `npm run llm:check`

In your own terminal, with the six `JEV_*` lines in your own `.env` (copy the names from `.env.example`):

```bash
npm run llm:check
```

For each configured provider it sends three fictional complaints (a leak under a sink, a corridor light, uncollected garbage) and prints one line per sample: the
provider name, the HTTP status, the latency, the top category and the top urgency with their probabilities. A provider with a bad or missing setting gets one plain line
(`opencode: invalid (URL_NOT_HTTPS), not checked: look at JEV_PRIMARY_URL`), and a line says whether the shared settings are default, set or invalid. It never prints
a key, a URL or a body. Exit 0 if at least one provider answered; 1 if none did (including when none is usable); an invalid setting no longer has its own exit code. It uses three calls per provider.

## Rotating a key

1. Make the new key in the provider's console.
2. Put it in your own `.env`, run `npm run llm:check`, and see HTTP 200 lines.
3. In the Vercel dashboard (Settings, Environment Variables) replace the value of `JEV_PRIMARY_KEY` or `JEV_SECONDARY_KEY`, then redeploy so every instance starts with it.
4. Revoke the old key. If a key was ever pasted anywhere else, treat it as leaked and rotate it at once.

A 401 or 403 in the logs ("failure=CONFIG") means a key is wrong, expired or revoked; the provider is skipped for the cooldown and the keyword fallback answers.

## Limits

- No real provider has been called by this work; the protocol of both is assumed to be TypeSafe's (R50, R51).
- The thresholds that decide whether an answer is trusted are still the starting guesses of T10a (R36 to R38); the benchmark will set them.
- The breaker and cap are not shared between instances (D141); a bad setting disables that provider or falls back to its default and is named once, and never blocks a complaint (D145, R63 to R65).
- A response with a repeated JSON key keeps the last value (JSON parsing); the parser cannot see the duplicate.
