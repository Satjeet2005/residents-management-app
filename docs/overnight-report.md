# Overnight run report

## Phase table

| Phase | Status |
|---|---|
| 0 Preflight | superseded: the earlier run stopped here on a dirty tree (four old screenshots); this run proceeded and left them alone |
| A Committee report v2 | DONE (this section) |
| B Documentation package, runbooks and clean-clone script | DONE (the Phase B section below), with the UNVERIFIED items listed there |
| C Safety detection measurement | NOT STARTED |
| D Reconcile documents | NOT STARTED |
| E Final verification | NOT STARTED |

## Phase A: committee report v2

Preconditions: the T13g commits (`slaOutcome`, the acknowledgement fact in `src/server/complaints/board-views.ts`) and the T13h commits (board views, compact rows, pinned bar, fifth safety category) were in history; `npm run check` passed (4,473 tests before, 4,641 after).
No Phase A commit existed at the start; the working tree held only four modified old screenshots, which I did not touch.

### Number mapping

| This prompt said | Repository number |
|---|---|
| decisions for the report layout, charts, short rupee, sections cookie, duplicates | D154, D155, D156, D157, D158 |
| assumptions for short rupee, curve range, 8 weeks, six months, open/closed defaults, cookie, alert scope | R78 to R84 (and RC12 in `docs/committee-report.md`) |

### Commits (each ran `npm run check` and `npm run scan:secrets` through the hook and by hand: all passed)

| Hash | Message |
|---|---|
| b86bba2 | feat(lib): short rupee format for cards |
| 3735585 | feat(domain): monthly series and on-time rates by period |
| 9d0f0a9 | feat(domain): payment curve |
| fb40410 | feat(domain): weekly SLA series from the SLA outcome |
| 5954078 | feat(server): report data for cards, headlines and visuals (with its integration test) |
| ab47083 | feat(ui): chart and visual components with data tables |
| 0b0fb78 | feat(ui): alert strip and headline cards |
| 94ebe04 | feat(lib): chart words computed from the report data (extra commit, split from the sections) |
| 1adeeba | feat(ui): five collapsible sections with one-line summaries |
| 0cb57dc | feat(ui): choose sections with a remembered preference |
| 2b39565 | feat(ui): committee layout for phone, tablet and laptop |
| a172dcd | test: committee report v2 integration and render tests |
| fdc079f | fix(ui): keep chart labels off the lines (extra, found in screenshots) |
| 9e5902a | test: committee report at three widths in a browser |
| (this) | docs: committee report v2 and decisions |

### Independent SQL figures beside the loader's (as of 27 Oct 2026, pristine seed)

`tests/integration/committee-report-v2.test.ts` compares, with SQL written in the test: the money line of each of six months (billed, collected), on-time numerators and denominators per month, the payment curve at days 0, 5, 9, 20 and the as-of day, the weekly SLA raised, decided and met for each of eight weeks, the October SLA share, and the unacknowledged safety count. All equal. (After the full e2e run the seed is changed; the integration run uses its own scratch database.)

### Query count and page-data time

10 database operations (counted with a Prisma client extension), 1.4 s for the whole page data on the 2,400-flat seed (limit 3 s). Existing RP2 speed test: unchanged and passing.

### Mutations (failing tests, then restored from a copy; `git diff` clean each time)

1. payment curve day +1: 4 failures in `payment-curve.test.ts` (day 0 counts, due day, late fee, PC2 relationship).
2. chart without its table: 11 failures in `charts.test.ts` (CH1 for each component).
3. hidden section still rendered: 3 failures in `committee-choose.test.ts` (CC2).
4. collected and outstanding swapped: 3 failures in `series.test.ts` (SE2 twice, SE4 property).
5. Goals section reintroduced: 1 failure, `committee-blocks.test.ts` CB5 "five sections in order... no Goals section".
6. "Paid late" row restored: 1 failure, CB1 "exactly three rows and no 'Paid late' row".
7. late reply counted as met: 2 failures in `weekly-sla.test.ts` (late reply NOT met; slaShare agrees with complaintMetrics).

### Phase-end commands

- `npm run check`: 197 files passed, 4,641 tests passed, 1 skipped; `npm run scan:secrets`: no secrets found.
- `npm run test:ci-parity`: unit 4,641 passed; integration 74 files, 1,105 tests passed.
- `npm run e2e`: 79 passed (3.3 min), including the 18 new tests at 360, 768 and 1280.
- No leftover `township_*` database or `app_t_*` role afterwards (queried).

### Screenshots (docs/screenshots, each under 400 KB, written by the e2e run)

`committee-report-{360,768,1280}.png`, `committee-report-open-{360,768,1280}.png`, close-ups `committee-m1-collected-360`, `m2-on-time-360`, `m3-monthly-360`, `m4-ageing-360`, `c1-monthly-1280`, `c3-curve-1280`, `c4-weekly-1280`, and `committee-choose-{360,768,1280}.png`.

### Awkward things I saw, and what I did

Fixed (commit fdc079f): the goal label sat on the sparkline's data line; the series name sat on the line of a line chart; the last week tick ("26 Oct") was clipped at the right edge.
Not fixed: (a) SVG text scales with the chart, so at 1280 the "What is owed" bar labels (a 320-unit drawing in a 600px column) are about 1.9 times larger than the 14px text elsewhere; (b) in the 1280 two-column grid a short section leaves empty space beside a tall one (items are top aligned); (c) the "Total owed" card is shorter in content than its neighbours but is stretched to their height; (d) the weekly chart's series name still touches the line near a dip.

### Existing tests I edited, and why

- `tests/ui/committee-blocks.test.ts`: rewritten for the new components (props changed: no `period`; Goals block removed; quality has three rows; complaints six lines; reconciliation three lines).
- `tests/ui/committee-ageing.test.ts`: the old segmented bar became the M4 chart; the page test looks for `<details id="owed">`.
- `tests/ui/committee-report-shell.test.ts` (money section: props, two sentences instead of a fee table), `tests/ui/committee-states.test.ts` (selector for the owed section), `tests/ui/committee-fixtures.ts` (new fields, cards computed from the merged report).
- `tests/integration/committee-report.test.ts`: the full-page test expects the new section titles and no Goals heading; the name/phone scan also asserts the chart tables are in the scanned HTML.
- `tests/e2e/helpers/checks.ts`: closed `<details>` content is not counted as visible (it is not on screen); `playwright.config.ts`: three new projects.
No assertion was weakened: each removed assertion described a block that no longer exists (D158).

### Deviations from the prompt, with reasons

- Integration test of the loader is in commit 5, not 11 (code and its tests together); commit 11 holds the page-level integration additions.
- `monthlySeries(positions, periods)` and `paymentCurve({bills, issueDate, dueDate, asOf})` take positions/bills, not `asOf` alone, because the positions are already built as of the date.
- "Each chart beside its section" at 1280: charts are inside their section (sections are in two columns); a chart is not placed in a separate column beside the text (the section is only half the page wide).
- The sections' `<details>` are closed in the HTML and opened by the client on 768px+ (the server cannot know the width); with no script they stay closed.
- The weekly chart is not drawn when no week has a share (an empty chart says nothing); its table is then also absent.
- Choose sections buttons are outlined (the report has no filled control).
- Safety line counts the month's safety complaints without an acknowledgement; the alert strip counts any month, still open (R84).
- I did not stage the screenshots that e2e rewrote and that are not committee ones (the four that were already dirty and about 20 others, mostly a few bytes of change); they remain modified in the working tree.

### Unverified

- Contrast was checked from the token hex values (unit test) and by axe in the browser, not by eye on every chart.
- The complaints figures after the full e2e run changed (the resident flows raise complaints); the integration tests use their own database.
- A real phone: only Chromium emulation was used.
- The docs say Improvado, Wolfpixel, NN/g, Carbon, Onething, Boundev, Keen and DataCamp support the design; these sources were named by the human and were not read in this run.
- I read my own source diffs as I wrote them, but did not print every full staged diff before each commit; for test files I reviewed the diff stat and the test names, not each line.

## Phase B: documentation package, runbooks and the clean-clone script

Status: DONE, with the UNVERIFIED items listed below. Documentation and scripts only: no application behaviour changed (the only code-adjacent changes are `docker-compose.yml`, `.env.example` and a new shell script).

### Step 0: state, disk and resume

- `git status --short` at the start: only the 21 tracked screenshots under `docs/screenshots` that a browser run had rewritten (not staged in any Phase B commit, and still modified). No Phase B file existed (`deployment.md`, `docs/security.md`, `docs/known-limitations.md`, `docs/live-refresh-runbook.md`, `docs/hosted-reset-procedure.md`, `scripts/verify-clean-clone.sh`, `docs/submission-checklist.md` were all absent), so nothing was resumed.
- `git log --oneline -40` started at `1dbbaf4 docs: committee report v2 and decisions`.
- Preconditions: the Phase A commits (`b86bba2` to `1dbbaf4`) and the T9d observability commits (`41a436f` readiness, `a59d474`, `1b4ea6e`, `f06b8c1`, `9efa6d6`) are in history; `npm run check` passed (4,641 tests passed, 1 skipped) before any change.
- Disk before: `df -h .` 195 G, 171 G used, **14 G free (93 percent)**; `docker system df`: images 6.76 GB, containers 8 MB, volumes 1.77 GB, build cache 19.25 GB (16.39 GB reclaimable). More than 3 GB was free, so `npm ci`, the build and the full clean-clone verification were run. Nothing was deleted to make room and no `docker prune` was run. Disk after the phase (temporary directories removed): `df -h .` 195 G, 172 G used, 14 G free (93 percent) after the temporary clean-clone directories (about 1.7 G each) were removed; `docker system df`: volumes 1.787 GB (1.77 GB before), nothing else changed.

### Number mapping (docs/decisions.md and docs/assumptions.md are authoritative)

| This prompt said | Repository number |
|---|---|
| the compose port override (B7) | D159 |
| the clean-clone script and its isolation (B8) | D160 |
| the owner-only hosted reset outside the app (B5) | D161 |
| assumptions: the unverified Neon schema drop and fallback; the schema `USAGE` grant; placeholder addresses; NIST and DPDP statements without a recorded source; owner role in local smoke runs | R85, R86, R87, R88, R89 |

### Commits (each ran `npm run check` and `npm run scan:secrets` by hand and again through the pre-commit hook: all passed, 4,641 tests passed and 1 skipped each time; "no secrets found" each time)

| Hash | Message | check | scan |
|---|---|---|---|
| dbe03eb | feat: compose database port override | pass | pass |
| c6ff16a | feat: clean-clone verification script | pass | pass |
| 11b394e | docs: write the logs reader options as --name=value | pass | pass |
| 55b1907 | docs: security notes | pass | pass |
| fb4cb07 | docs: known limitations | pass | pass |
| 46c73da | docs: live refresh runbook | pass | pass |
| 375bd52 | docs: hosted reset procedure with tested evidence | pass | pass |
| ee200c9 | docs: submission checklist | pass | pass |
| ea1b597 | docs: deployment.md | pass | pass |
| 1496803 | docs: README start-here list and placeholders | pass | pass |
| 0bfa4f7 | docs: decisions and assumptions for the documentation package | pass | pass |
| 203bffe | docs: do not cite edge-case timelines the repository lacks | pass | pass |
| (this) | docs: Phase B report | see "Phase end" | see "Phase end" |

### Deviations from the prompt, with reasons

1. **Commit order.** The prompt listed deployment.md first and the compose and script commits seventh and eighth. I committed in this order: compose (7), script (8), the logs-option fix (extra), security (2), limitations (3), runbook (4), reset (5), checklist (9), deployment (1), README (6), decisions (extra). Reason: deployment.md documents `DB_PORT` and quotes real output of the script, so both had to exist and be run first; and each document links the ones committed before it, so no commit has a link to a file that does not exist yet (the submission checklist and deployment.md still refer to each other, one forward reference).
2. **Drafting outside the working tree.** I wrote the five documents while the clean-clone run was going, then moved them out of the tree (to the scratchpad) so the working tree equalled the commit when each check ran, and restored one per commit.
3. **Three extra commits**: `11b394e` (the logs reader examples; found by the rehearsal), `0bfa4f7` (decisions and assumptions, so the new documents' decisions have numbers) and `203bffe` (a wording fix found on a last read: the repository has no "edge-case timelines" document).
4. **Variables removed in the script.** After reviewing the staged script I added the removal of `DATABASE_URL` and the other redirecting variables (D160) before committing; the first full run (below) was made before that fix, so a second run, with bogus values in the environment, was made after it.
5. `docs:verify` is not in `package.json`, so `deployment.md` does not mention it.

### The clean-clone script (scripts/verify-clean-clone.sh)

Checked with `bash -n` (no shellcheck on this machine). Run in an EMPTY temporary directory against a `cp`-style copy of the working tree (`--local-copy`, which excludes `node_modules`, `.next`, `.env`, `.git`, `test-results`, `generated`), with the OS choosing free ports and a unique compose project.

**Run 1: the full path, including `npm ci` and `test:ci-parity` (before the variable-removal fix)**

```
RESULT TABLE
No   Step                                                           Result Seconds
1    get the code (clone or copy)                                   PASS   0
2    Node matches .nvmrc                                            PASS   0
3    npm ci                                                         PASS   9
4    write .env with fresh secrets                                  PASS   0
5    start the database (own container)                             PASS   3
6    prisma migrate deploy                                          PASS   2
7    seed the demo data                                             PASS   4
8    next build                                                     PASS   16
9    start the app                                                  PASS   1
10   smoke:auth, a resident (5000000006)                            PASS   0
11   smoke:auth, a staff member (5000000001)                        PASS   1
12   test:ci-parity (unit and integration)                          PASS   294
OVERALL: PASS      (unit 4,641 passed, 1 skipped; integration 74 files, 1,105 tests passed)
```

**Run 2: after the fix, with `DATABASE_URL=postgresql://nobody:...@example.invalid:5432/other`, `DEMO_AS_OF=2020-01-01`, `OTP_PEPPER=short` and `DB_PORT=1` in the environment, `--quick`**: steps 1 to 11 PASS (npm ci 8 s, build 17 s, smoke:auth resident and staff PASS), step 12 SKIP (`--quick`), `OVERALL: PASS`: the bogus values were ignored and nothing reached the invalid host.

**Negative runs (exit codes):** a non-empty directory: exit 2, "Refusing to run: ... is not empty"; `VCC_DB_PORT=5436` (the development database's port): exit 2, "Port 5436 (the database) is already in use"; no arguments: usage, exit 2; a copy whose `.nvmrc` says 99.0.0: step 2 FAIL, steps 3 to 12 SKIP, exit 1, "OVERALL: FAIL (1 step failed)", nothing started so nothing to clean.

**Cleanup verified** after each run: no container, volume or network named `*vcc*` (`docker ps -a`, `docker volume ls`, `docker network ls`), and no server process of mine left (the server was stopped by its PID; other `next-server` processes that were already running from the user's own sessions were not touched).

**Not verified:** the `git clone` branch of the script (this run was told not to clone anything) and `--skip-install` (never run: the full `npm ci` path was affordable, so it was not needed).

### Phase B: SQL evidence (every statement of docs/live-refresh-runbook.md, against a freshly migrated and seeded LOCAL scratch database)

Database `township_seed_scratch`, printed with `SELECT current_database()` first (`township_seed_scratch`, role `township`); created in the development container, migrated (`7 migrations`, "Database schema is up to date!") and seeded (`total 78091`). Roles were `app_t_rf_app` and `app_t_rf_logs` (the documented `township_app` and `township_logs`, renamed). The helper `runsql` and the two settings blocks were extracted from the runbook text and run, so the documented text is what ran; random role passwords were generated and never printed (substituted by `[pw]` below). The first attempt found two defects, both fixed in the text before its commit: `runsql -f file` was parsed by Node as an option (fixed with `--`), and `npm run logs:errors -- --ref E-XXXXXX` is refused (the reader takes `--ref=E-XXXXXX`; the same wrong form was in `README.md`, `docs/observability.md` and `docs/deploy-checklist.md` and was fixed in `11b394e`).

```
## role creation (the statement of deploy-checklist C3, role renamed to app_t_rf_app)
CREATE 
ALTER 

## step 3: print, head, run, verify
-- Grants for the application role "app_t_rf_app", generated from src/server/db-roles/app-role.ts.
-- Run as the owner role "township". It creates no role and sets no password. Running it again is safe.
lines mentioning password: 2
node: bad option: -f

┌─────────┬───────────────────┬─────────────────┬───────────────────┬──────────────────┐
│ (index) │ can_insert_errors │ can_read_errors │ can_update_ledger │ can_delete_audit │
├─────────┼───────────────────┼─────────────────┼───────────────────┼──────────────────┤
│ 0       │ false             │ false           │ false             │ false            │
└─────────┴───────────────────┴─────────────────┴───────────────────┴──────────────────┘

## step 3 again, with the fixed helper (runsql -f ...)
DO  REVOKE  REVOKE  REVOKE  REVOKE  DO  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  
┌─────────┬───────────────────┬─────────────────┬───────────────────┬──────────────────┐
│ (index) │ can_insert_errors │ can_read_errors │ can_update_ledger │ can_delete_audit │
├─────────┼───────────────────┼─────────────────┼───────────────────┼──────────────────┤
│ 0       │ true              │ false           │ false             │ false            │
└─────────┴───────────────────┴─────────────────┴───────────────────┴──────────────────┘
## second run of the grants (safe to repeat)
DO  REVOKE  REVOKE  REVOKE  REVOKE  DO  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  

## a wrong owner is refused by the guard
P0001 Run this as the owner role someone_else, not as township

## step 4 (statements copied from the runbook text), run twice
-- pass 1: threshold
UPDATE 1
┌─────────┬────────────────────────────┬─────────┐
│ (index) │ key                        │ value   │
├─────────┼────────────────────────────┼─────────┤
│ 0       │ 'approval_threshold_paise' │ 1000000 │
└─────────┴────────────────────────────┴─────────┘
-- pass 1: goals
INSERT 0
┌─────────┬───────────────────┬──────────┐
│ (index) │ key               │ value    │
├─────────┼───────────────────┼──────────┤
│ 0       │ 'committee_goals' │ [Object] │
└─────────┴───────────────────┴──────────┘
-- pass 2: threshold
UPDATE 1
┌─────────┬────────────────────────────┬─────────┐
│ (index) │ key                        │ value   │
├─────────┼────────────────────────────┼─────────┤
│ 0       │ 'approval_threshold_paise' │ 1000000 │
└─────────┴────────────────────────────┴─────────┘
-- pass 2: goals
INSERT 0
┌─────────┬───────────────────┬──────────┐
│ (index) │ key               │ value    │
├─────────┼───────────────────┼──────────┤
│ 0       │ 'committee_goals' │ [Object] │
└─────────┴───────────────────┴──────────┘
-- the seed already holds both: show before change by first setting the old value
UPDATE 1
DELETE 1
-- after simulating an older hosted database (threshold 25,000 rupees, no goals row):
UPDATE 1
┌─────────┬────────────────────────────┬─────────┐
│ (index) │ key                        │ value   │
├─────────┼────────────────────────────┼─────────┤
│ 0       │ 'approval_threshold_paise' │ 1000000 │
└─────────┴────────────────────────────┴─────────┘
INSERT 1
┌─────────┬───────────────────┬──────────┐
│ (index) │ key               │ value    │
├─────────┼───────────────────┼──────────┤
│ 0       │ 'committee_goals' │ [Object] │
└─────────┴───────────────────┴──────────┘

## step 7a to 7d (role renamed app_t_rf_logs)
CREATE 
-- Grants for the READ-ONLY logs role "app_t_rf_logs", generated from src/server/db-roles/logs-role.ts.
-- Run as the owner role "township". It creates no role and sets no password. Running it again is safe.
DO  REVOKE  REVOKE  DO  GRANT  GRANT  
-- 7c
Reading error events from host localhost:5436, database township_seed_scratch (read-only).
No error events matched. Widen --since or drop a filter.
-- 7d
42501 permission denied for table users
exit 1

## step 8: the ops test route and the reference
-- without the header:
HTTP 404
-- with the token: {"ref":"E-GY1ZHM"}
Unknown argument "--ref". Usage: npm run logs:errors -- [--since=30m|1h|24h|7d] [--ref=E-XXXXXX] [--digest=N] [--request-id=ID] [--route=TEXT] [--level=warn|error] [--source=ROUTE|PAGE|ACTION|MIDDLEWARE|PROVIDER|JOB|AUDIT|TEST] [--limit=1..200] [--json | --paste]

## step 9: smoke:auth without --allow-owner-role (the server uses the non-owner app role)
smoke:auth: readiness of http://localhost:43989
PASS  config.otpPepper              OTP_PEPPER is set, 32 or more characters, not the placeholder
PASS  config.webhookSecret          PAYMENT_WEBHOOK_SECRET is set, 32 or more characters, not the placeholder
PASS  appRole.isSuperuser           false (must be false)
PASS  appRole.canInsertOtp          true (must be true)
PASS  appRole.canUpdateLedger       false (must be false)
PASS  appRole.canDeleteAuditLog     false (must be false)
PASS  appRole.canInsertErrorEvents  true (must be true)
PASS  appRole.canReadErrorEvents    false (must be false)
ALL 13 CHECKS PASSED
smoke:auth: readiness of http://localhost:43989
PASS  config.otpPepper              OTP_PEPPER is set, 32 or more characters, not the placeholder
PASS  config.webhookSecret          PAYMENT_WEBHOOK_SECRET is set, 32 or more characters, not the placeholder
PASS  appRole.isSuperuser           false (must be false)
PASS  appRole.canInsertOtp          true (must be true)
PASS  appRole.canUpdateLedger       false (must be false)
PASS  appRole.canDeleteAuditLog     false (must be false)
PASS  appRole.canInsertErrorEvents  true (must be true)
PASS  appRole.canReadErrorEvents    false (must be false)
ALL 13 CHECKS PASSED

## step 8 again: the reader takes --ref=VALUE (the space form is refused, see above)
ref: E-ZBP4K1
Reading error events from host localhost:5436, database township_seed_scratch (read-only).
ref: E-ZBP4K1
time: 2026-11-08T06:09:46.734Z
level: WARN
source: TEST
route: /api/ops/error-test
method: -
status: -
error name: OpsTest
error code: -
message: ops test
stack:
-
deployment: -
```

The server for steps 6, 8 and 9 was a `next start` of the clean-clone build, connecting as the NON-owner role `app_t_rf_app`; its readiness report was HTTP 200:

```
{"status":"ok","checks":{"config":{"otpPepper":true,"webhookSecret":true,"demoMode":true,"opsTestEnabled":true,"vercelSystemVars":false,"nodeMajor":24},"database":"ok","schema":{"missingTables":[]},"appRole":{"isSuperuser":false,"canInsertOtp":true,"canUpdateLedger":false,"canDeleteAuditLog":false,"canInsertErrorEvents":true,"canReadErrorEvents":false},"data":{"seeded":true}}}
```

`npm run smoke:auth` without `--allow-owner-role` against it: ALL 13 CHECKS PASSED as a resident and as staff.

`npm run smoke:app` (a mutating script) was run against that scratch server with `--as-of=real --demo=true`: **21 OF 162 CHECKS FAILED**. The failing checks are all about the committee report (section titles such as "Money, October 2026", the ageing and reconciliation blocks) and the staff complaints board (six lane tabs, "Safety lane"): text of screens that Phase A and T13h redesigned after the script was last changed (2026-11-07). None is a login or permission check. The one that mentions money (the five age groups adding to the total due) read "₹62,13,690 = ₹0" because the markup it parses is gone (the groups it found were `[null,null,null,null,null]`), so it is also a stale check; the ageing totals themselves are checked against independent SQL in `tests/integration/committee-report-v2.test.ts`. Not fixed (a test-script change outside this task); recorded in `docs/known-limitations.md` and `deployment.md`.

### Phase B: hosted reset rehearsal (the WHOLE procedure of docs/hosted-reset-procedure.md on the same local scratch database, only the owner and database names and the role names adapted)

```
## BEFORE: the scratch database as consumed by smoke:app
┌─────────┬────────────────┬───────────┬──────────────┬─────────┬──────────┬──────────┐
│ (index) │ ledger_entries │ audit_log │ error_events │ imports │ attempts │ sessions │
├─────────┼────────────────┼───────────┼──────────────┼─────────┼──────────┼──────────┤
│ 0       │ '25633'        │ '70'      │ '2'          │ '2'     │ '2'      │ '9'      │
└─────────┴────────────────┴───────────┴──────────────┴─────────┴──────────┴──────────┘

## step 1: enter the owner string (here: the local owner, host localhost)
localhost /township_seed_scratch

## step 2
┌─────────┬─────────────────────────┬────────────┐
│ (index) │ database                │ role       │
├─────────┼─────────────────────────┼────────────┤
│ 0       │ 'township_seed_scratch' │ 'township' │
└─────────┴─────────────────────────┴────────────┘

## step 3 (owner and database names adapted: township, no change otherwise)
BEGIN 
DROP 
CREATE 
GRANT 
COMMIT 

## step 4

All migrations have been successfully applied.

Database schema is up to date!

## step 5
DO  REVOKE  REVOKE  REVOKE  REVOKE  DO  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  GRANT  

## step 6
DO  REVOKE  REVOKE  DO  GRANT  GRANT  

## step 7 (seed; --allow-remote and --confirm-database as documented)
Target: host localhost:5436, database township_seed_scratch
  total                   78091
Time: 3.1 s. Database size: 29.9 MB.

## step 8
UPDATE 1
INSERT 0
┌─────────┬────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────┐
│ (index) │ key                        │ value                                                                                   │
├─────────┼────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
│ 0       │ 'approval_threshold_paise' │ 1000000                                                                                 │
│ 1       │ 'committee_goals'          │ '{"reopenedPercentMax":8,"onTimeCollectionPercent":90,"firstReplyWithinSlaPercent":90}' │
└─────────┴────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────┘

## AFTER
┌─────────┬────────────────┬───────────┬──────────────┬─────────┬──────────┬──────────┐
│ (index) │ ledger_entries │ audit_log │ error_events │ imports │ attempts │ sessions │
├─────────┼────────────────┼───────────┼──────────────┼─────────┼──────────┼──────────┤
│ 0       │ '25579'        │ '0'       │ '0'          │ '0'     │ '0'      │ '0'      │
└─────────┴────────────────┴───────────┴──────────────┴─────────┴──────────┴──────────┘
elapsed for steps 1 to 8: 7 s

## step 9 (readiness and smoke:auth after the reset; the server uses the non-owner app role)
{"status":"ok","checks":{"config":{"otpPepper":true,"webhookSecret":true,"demoMode":true,"opsTestEnabled":false,"vercelSystemVars":false,"nodeMajor":24},"database":"ok","schema":{"missingTables":[]},"appRole":{"isSuperuser":false,"canInsertOtp":true,"canUpdateLedger":false,"canDeleteAuditLog":false,"canInsertErrorEvents":true,"canReadErrorEvents":false},"data":{"seeded":true}}}
HTTP 200
ALL 13 CHECKS PASSED
```

The rehearsal was NOT run on Neon.

### Findings worth the human's attention

- **Docs bug fixed:** the logs reader accepts only `--name=value`; three documents had `--ref E-XXXXXX` (commit `11b394e`).
- **Not built, found while writing the limitations:** `outbox_jobs` has no processor (`processOutbox()` in `CLAUDE.md` does not exist) and there is no cron route, so nothing is ever sent and the 24-hour hold escalation cannot run (`docs/known-limitations.md`). `CLAUDE.md` still says "one idempotent `processOutbox()`".
- **`smoke:app` is stale** (21 failing checks above).
- **`npm ci` prints a warning** that three packages' install scripts are blocked (`@prisma/engines`, `esbuild`, `prisma`): harmless in every run here, documented in `deployment.md`.
- **Local readiness is 503 by design** (the container's user is the owner), which is why the local smoke needs `--allow-owner-role`; the hosted report must be 200.
- Dates: the seed is dated 27 October 2026 and the app uses today's date (8 November 2026 in this session), so live numbers differ from the brief's sample.

### UNVERIFIED items, with the reason

| Item | Reason |
|---|---|
| The `git clone` branch of `verify-clean-clone.sh`, and the `git clone` step of `deployment.md` | The instructions forbade cloning; the `--local-copy` branch was run and the clone branch was only read |
| `--skip-install` | Not run: a real `npm ci` was affordable |
| Everything on real Neon and Vercel: the runbook, the hosted reset (and whether `neondb_owner` may drop `public`, R85), the live readiness report, the address `<LIVE_URL>` | No access to the accounts (and none wanted); only a local Postgres 16 was used |
| The five-minute reviewer path | Taken from the README walkthroughs, the e2e specs and the page source; no hand click-through in a browser in this session. The e2e result (79 passed) is carried from Phase A and was NOT re-run (it rewrites tracked screenshots) |
| `npm run llm:check` | Needs the human's provider keys and the free quota |
| NIST SP 800-63B "restricted authenticator" and the DPDP Rules dates (R88) | No source or date recorded in the repository; nothing fetched |
| The Docker, Node and `EADDRINUSE` / "port is already allocated" messages in "Common problems" | The usual messages of those tools, not provoked here; the script's own refusals were |
| The Hindi and Marathi safety words | Not reviewed by a native speaker (unchanged) |
| A real phone | Not used |

### Placeholders the human must fill

- `<LIVE_URL>`: the hosted address (likely https://residents-management-app.vercel.app: confirm). In `README.md` (first screen), `deployment.md`, `docs/submission-checklist.md`.
- `<REPO_URL>`: the public repository address (the checklist names `Satjeet2005/residents-management-app`: confirm). Same files and the clone step.
- The submission checklist's own items (`docs/submission-checklist.md`): the TDD header and sections, the ZIP, the native-speaker review, the owner reset last, the DEMO_MODE decision.

### Phase end

- `npm run check` (last run after the final content change): 197 test files passed, **4,641 tests passed, 1 skipped**; `npm run scan:secrets`: `scan:secrets: no secrets found`.
- `npm run test:ci-parity` (against the development container, no `.env`, only `DATABASE_URL`): unit 197 files, 4,641 passed, 1 skipped; integration **74 files, 1,105 tests passed** (about 4 minutes). It ran before the last two small documentation commits (`203bffe` and this report), which change no code or test input.
- Leftovers verified by query after the phase: databases starting `township` in the development container: only `township` (no `township_seed_scratch`, no `township_test_*`); roles `app_t_*`: 0; roles `township_*`: 0; containers, volumes and networks named `*vcc*`: 0; no server process of mine running (my `next start` processes were each stopped by PID, checked by their working directory; none of the 44 `next-server` processes now alive was started in this session: they are 47 minutes to 18 hours old and belong to earlier sessions, I did not touch them, they hold ports and memory and you may want to stop them).
- `git status --short` after: the same 21 modified screenshots as at the start (never staged), plus nothing else.
- Not pushed. Phase C not started.

