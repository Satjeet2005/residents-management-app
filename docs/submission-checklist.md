# Submission checklist (for the human)

Written 2026-11-08. Tick each box yourself; the agent cannot do these for you. Items marked **LAST** must come after everything else. Commands run in a terminal in the repository root unless it says otherwise.
`<LIVE_URL>` and `<REPO_URL>` are the placeholders listed at the end of `deployment.md`: fill them everywhere before you submit.

## Repository

- [ ] **Repository is public.** Open `<REPO_URL>` in a private browser window, not signed in to GitHub. **Expected:** the code is visible.
- [ ] **No secrets in the tree.** `npm run scan:secrets`. **Expected:** `scan:secrets: no secrets found`.
- [ ] **No secrets in the history.** Run gitleaks over the full history with the same pinned version as CI (8.24.3, see `.github/workflows/ci.yml`; the checksum check is in that file): `gitleaks git --redact --exit-code 1 --no-banner --verbose .`. **Expected:** no leaks found, exit 0. Check also that `git ls-files | grep -E '(^|/)\.env$'` prints nothing.
- [ ] **History is clean.** `git log --oneline` reads as one logical change per commit, Conventional Commit messages, no "WIP", "fix" or "update". `git status --short` shows no stray file; the tracked screenshots under `docs/screenshots` that a browser run rewrites are either committed on purpose or left out (decide, do not stage them by accident).
- [ ] **CI is green.** On GitHub, Actions: the latest run on the branch you submit passed (it runs lint, typecheck, unit tests, build, integration tests, the secret scan and gitleaks).
- [ ] **Last push time is after the last change.** `git log -1 --format=%cd` and the GitHub "commits" page show the same last commit; nothing is committed locally and unpushed (`git status -sb` shows no "ahead").

## The live site

- [ ] **Live link works.** Open `<LIVE_URL>` in a private window. **Expected:** the login page loads with no Vercel login screen in front.
- [ ] **Readiness is ok.** `curl -s "<LIVE_URL>/api/health/ready"`. **Expected:** `"status":"ok"`, `"data":{"seeded":true}`; read every line against the table in `docs/live-refresh-runbook.md`, step 6.
- [ ] **Demo logins verified on the LIVE site** (not only locally): for each phone in the "Demo logins" table of `deployment.md`, open `<LIVE_URL>/login`, enter the phone, press "Send code", and sign in with the code shown in the banner. At least: `5000000001` (staff, matching), `5000000002` (staff, approving), `5000000003` (committee), `5000000005` (duty manager), `5000000006` and `5000000007` (residents). One code per 30 seconds and 5 an hour per phone: use another phone if you see "Try again in ...".
- [ ] **The five-minute path works on the live site** (`deployment.md`, "A five-minute reviewer path"), in a private window at phone width and at laptop width. This consumes demo data, so the reset below comes after it.
- [ ] **Hosted data is current.** The steps of `docs/live-refresh-runbook.md` are done (migrations, grants, the two settings, variables, redeploy). In particular `DEMO_AS_OF` is not set in Vercel, and `LOGS_DATABASE_URL` is not set in Vercel.
- [ ] **Installable.** On a phone, Add to Home Screen works; offline shows the offline page (`docs/live-refresh-runbook.md`, step 10).

## A clean clone works

- [ ] **`deployment.md` followed on a clean clone.** In an EMPTY temporary directory, with Docker running: `mkdir /tmp/township-verify && cd /tmp/township-verify && bash <path>/scripts/verify-clean-clone.sh <REPO_URL>`. **Expected:** every row PASS and `OVERALL: PASS`; takes several minutes (add `--quick` to skip the unit and integration tests). It uses its own database container and free ports, so it does not disturb your development database; remove the temporary directory yourself afterwards.

## The technical design document (TDD)

- [ ] The GitHub URL (`<REPO_URL>`) and the live link (`<LIVE_URL>`) are at the top.
- [ ] It contains each required section: architecture and why; data model; main flows; how the AI works; key screens and why; what was cut and what is next; an assumptions table; the invariants list; benchmark results with their method; limitations.
- [ ] Its numbers match `docs/numbers-to-know.md` and the counts in `deployment.md` ("Testing"); `docs/known-limitations.md` and `docs/security.md` agree with its limitations section.
- [ ] The Hindi and Marathi safety words are reviewed by a native speaker and the result is recorded in the review column of `docs/safety-words-review.md` (until then the TDD must say they are not reviewed).

## The package

- [ ] **ZIP contents and size.** Create it from the repository without `node_modules`, `.next`, `.env`, `.git` history if the brief asks for source only, and `test-results` (for example `git archive --format=zip -o township.zip HEAD` from a clean checkout). **Expected:** it opens, holds `README.md`, `deployment.md`, `docs/`, `src/`, `tests/`, `prisma/`, and no `.env`; the size is within the limit the brief sets.
- [ ] **Screenshots.** `docs/screenshots` holds the pictures the TDD refers to, each under 400 KB.
- [ ] **Every placeholder is filled.** `grep -rn "<LIVE_URL>\|<REPO_URL>" README.md deployment.md docs` prints nothing in the files you submit (or only the places that deliberately keep the placeholder, such as this file).

## The demo itself

- [ ] **The demo script rehearsed twice** from `docs/demo-script.md`, with the fallbacks, on the live site.
- [ ] **The owner reset of the hosted database done LAST** (`docs/hosted-reset-procedure.md`), after every rehearsal and check above, if the demo data was consumed. Afterwards run only `smoke:auth` against the live site.
- [ ] **The DEMO_MODE decision after the review window.** While reviewers need to sign in it stays `true`. When the window ends, decide: set `DEMO_MODE=false` in the Vercel dashboard and Redeploy (nobody can sign in then), or take the site down (`docs/deploy-checklist.md`, Part G). Write the date you will decide in your calendar.
- [ ] **Keep it alive.** A reminder every 14 days to open the Vercel and Neon consoles and the live site (`docs/deploy-checklist.md`, Part F).
