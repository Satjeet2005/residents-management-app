# docs

An index of every document in this folder, grouped by purpose, with a status. Status words: current, historical (a record of a past task) or superseded. `npm run docs:verify` checks the paths named in these documents.

## Decisions and assumptions

| File | What it is | Status |
|---|---|---|
| [`decisions.md`](decisions.md) | The decision log (D1 onward) with status and where each shows in code | current |
| [`assumptions.md`](assumptions.md) | The assumptions register (R1 onward) | current |
| [`known-limitations.md`](known-limitations.md) | What is not done or not true yet, with effort | current |
| [`committee-audit-disposition.md`](committee-audit-disposition.md) | What was done with each finding of the committee audit | historical |
| [`committee-audit-report.md`](committee-audit-report.md) | The independent audit of the committee report | historical |

## Design

| File | What it is | Status |
|---|---|---|
| [`design-system.md`](design-system.md) | The Passbook look: tokens, type, targets | current |
| [`ui-architecture.md`](ui-architecture.md) | How pages, loading, errors and navigation are built | current |
| [`ui-fix-protocol.md`](ui-fix-protocol.md) | The repeatable way to fix a screen, with the acceptance checklist | current |
| [`auth-design.md`](auth-design.md) | Login, sessions and the public routes | current |
| [`payments-design.md`](payments-design.md) | Paying a bill, the demo gateway and the signed webhook | current |
| [`late-fee-policy.md`](late-fee-policy.md) | The late-fee rule and its rounding | current |
| [`matching-design.md`](matching-design.md) | Bank row matching rules and the posting plan | current |
| [`statement-import-design.md`](statement-import-design.md) | Importing a bank statement on the server | current |
| [`bank-statements.md`](bank-statements.md) | The canonical CSV schema and the narration parser | current |
| [`manual-reconciliation-design.md`](manual-reconciliation-design.md) | Manual matching of queued bank rows and the second approver | current |
| [`complaints-design.md`](complaints-design.md) | The complaint service, lifecycle and routes | current |
| [`complaint-classification.md`](complaint-classification.md) | How a complaint gets a category and an urgency | current |
| [`classifier-providers.md`](classifier-providers.md) | The two classifier providers, failover and the breaker | current |
| [`complaints-ui.md`](complaints-ui.md) | The resident complaint screens | current |
| [`staff-complaints-ui.md`](staff-complaints-ui.md) | The staff board and complaint page | current |
| [`staff-ui.md`](staff-ui.md) | The staff reconciliation screens | current |
| [`committee-report.md`](committee-report.md) | The committee report: figures, definitions and (top note) the current page structure | current, layout superseded by D194 |
| [`installable-app.md`](installable-app.md) | The installable web app and the offline page | current |
| [`seed-data.md`](seed-data.md) | The demo dataset | current |

## Build and run

| File | What it is | Status |
|---|---|---|
| [`browser-verification.md`](browser-verification.md) | How the browser checks work and what they measure | current |
| [`deploy-checklist.md`](deploy-checklist.md) | Steps for the human to deploy | current |
| [`deployment-plan.md`](deployment-plan.md) | Vercel and Neon facts and choices | current |
| [`live-refresh-runbook.md`](live-refresh-runbook.md) | Bringing the hosted deployment up to date | current |
| [`hosted-reset-procedure.md`](hosted-reset-procedure.md) | Resetting the hosted database (owner only) | current |
| [`submission-checklist.md`](submission-checklist.md) | What to check before submitting, and the placeholders to fill | current |
| [`jev-integration.md`](jev-integration.md) | What the classifier integration is and its live proof | current |

## Study material

| File | What it is | Status |
|---|---|---|
| [`walkthrough.md`](walkthrough.md) | How the app works, area by area | current, counts may lag |
| [`interview-prep.md`](interview-prep.md) | The hardest questions about this code | current |
| [`demo-script.md`](demo-script.md) | A five-minute demo | current, click paths not re-verified |
| [`numbers-to-know.md`](numbers-to-know.md) | The numbers to remember | current, counts may lag |

## Benchmarks and results

| File | What it is | Status |
|---|---|---|
| [`matching-benchmark.md`](matching-benchmark.md) | The matcher benchmark: method and results | current |
| [`safety-benchmark.md`](safety-benchmark.md) | The safety-word spelling benchmark | current |
| [`classifier-benchmark.md`](classifier-benchmark.md) | The classifier benchmark on synthetic complaints | current |
| [`safety-words-review.md`](safety-words-review.md) | The safety word list for a native speaker to review | current |
| [`overnight-report.md`](overnight-report.md) | Reports of the overnight runs | historical |

## Security and operations

| File | What it is | Status |
|---|---|---|
| [`security.md`](security.md) | Security notes | current |
| [`observability.md`](observability.md) | Where to look when something fails | current |

## Audits of single screens

| File | What it is | Status |
|---|---|---|
| [`ui-audit-emergency-sheet.md`](ui-audit-emergency-sheet.md) | Audit of the resident Emergency sheet | historical |
| [`ui-audit-reconciliation.md`](ui-audit-reconciliation.md) | Audit of the reconciliation workspace | historical |
| [`ui-audit-staff-home.md`](ui-audit-staff-home.md) | Audit of the staff home | historical |

## TDD source pack

`tdd-source/` holds facts only for the technical design document: [`README.md`](tdd-source/README.md) maps each section to a file (`01-architecture.md` to `10-screens.md`). Status: current.

## Other folders

`screenshots/` (browser pictures, size-limited), `design/` (the Passbook design images).
