FACTS ONLY. The human writes the narrative and the reasoning.

# TDD source pack

Facts, tables and cited rules for the technical design document. Date: 2026-11-09. Commit the pack was written on: 6cc7c0a.

| TDD section | File |
|---|---|
| Architecture and technology | [`01-architecture.md`](01-architecture.md) |
| Data model and database rules | [`02-data-model.md`](02-data-model.md) |
| Main flows | [`03-flows.md`](03-flows.md) |
| Invariants and how each is enforced and tested | [`04-invariants.md`](04-invariants.md) |
| Assumptions | [`05-assumptions.md`](05-assumptions.md) |
| Benchmarks | [`06-benchmarks.md`](06-benchmarks.md) |
| Limitations, cuts, next steps | [`07-limitations-cuts-next.md`](07-limitations-cuts-next.md) |
| Top 20 decisions | [`08-decisions-top20.md`](08-decisions-top20.md) |
| How the coding agent was used | [`09-ai-use-disclosure.md`](09-ai-use-disclosure.md) |
| Screens | [`10-screens.md`](10-screens.md) |

## How the facts were checked

- `npm run docs:verify` passes on this folder: every backticked path, test-file citation and `npm run` name exists.
- The `file :: function` references of `03-flows.md` were checked by a one-off script (file exists, function name appears in it); `docs:verify` does not read that form.
- The data model table is the output of `npm run tdd:data-model`.
- Numbers in `06-benchmarks.md` come from fresh runs of `npm run safety:benchmark` and `npm run classifier:benchmark -- --from-fixture`, and from the committed `expected.json` files of the matcher benchmark.
- Anything not verified says UNVERIFIED with the reason.
