# Demo script: 5 minutes

Written 2026-11-07. Button and screen words below were copied from `src/lib/messages/en.ts`; logins and the sequence from `README.md`; numbers from the tests named next to them. `UNVERIFIED` means I could not confirm it from the repository, and I did not run the app in a browser to write this script. Do one full dry run before the real demo.

## Before you start (do this 10 minutes early, not on stage)

1. Set `DEMO_MODE=true` and `DEMO_AS_OF=2026-10-27` in your own `.env`, plus a 32-character `PAYMENT_WEBHOOK_SECRET` (a production build refuses the placeholder: `README.md`, "Paying in the demo"). `DEMO_AS_OF` freezes "today" so the numbers below match. Do not open or paste your `.env` on screen.
2. Start from a clean database and the production build:
   `npm run db:seed -- --yes && npm run build && npm run start` (`README.md`, "Walking the reconciliation"). Open `http://localhost:3000`.
3. Open three separate browser profiles (or one normal and two private windows), because a login replaces the cookie in the same profile: **A** for staff Priya, **B** for staff Rahul, **C** for residents and the duty manager. Open `/login` in each.
4. Do the steps in this order. The order matters: the sample statement has a row that pays Swati Joshi's bill exactly (T12-0408, ₹6,468). If Swati pays through the gateway first, that row is queued instead of posted (`README.md`: "one fewer posted and one more needing you if Swati Joshi has paid through the demo gateway first").
5. Have the fallback material open in a tab: `docs/screenshots/` (72 images tracked in git, for example `reconciliation-import-1280.png`, `home-no-dues-1280.png`, `pay-demo-page-1280.png`, `home-safety-alert-1a-1280.png`, `board-safety-1280.png`, `report-top-1280.png`).

## The logins (demo phones; the code is shown in a banner: "Demo mode: your code is {code}")

| Who | Phone | Role | Used in step |
|---|---|---|---|
| Priya Nair | 5000000001 | staff, `payments:match` | 2 to 4 |
| Rahul Menon | 5000000002 | staff, `payments:match` and `payments:approve` | 4 |
| Meera Kapoor | 5000000003 | staff, `reports:view` | 7 |
| Sanjay Pawar | 5000000005 | duty manager: `complaints:manage` and `complaints:duty_manager` | 6 |
| Aamir Shaikh | 5000000009 | resident, flat T21-1601 | 5 |
| Swati Joshi | 5000000007 | resident, flat T12-0408 | 6 |

Log in at `/login`: type the phone, press **Send code**, then type the code from the banner and press **Log in**.

## Step 1. Open with the money problem (0:00 to 0:40)

**Do:** nothing on screen yet, or show `docs/screenshots/report-top-1280.png`.

**Say:** "A gated township of 2,400 flats bills maintenance every month. Residents pay by bank transfer and the bank statement says things like `UPI/…/T12-0408 Swati Joshi/maintenance`. Accounts staff match each line to a flat by hand. A wrong match puts money on the wrong flat, and the ledger can only grow, so a mistake is expensive to undo. This app automates only the clear cases and makes a person decide the rest." (2,400 flats: `CLAUDE.md`. Ledger append-only: `tests/integration/ledger-invariants.test.ts :: "I3 rejects UPDATE and leaves the row unchanged"`.)

**Fallback:** none needed; this step is speech.

## Step 2. Run the sample statement through the matcher (0:40 to 1:40)

**Do (profile A):** log in as Priya Nair, 5000000001. On `/staff` open **Bank reconciliation**. Press **Use the sample statement**. Open the new import from the recent imports list.

**Say:** "This is a made-up bank statement of 106 rows. The matcher read every row and put each in exactly one state. The bar says 25 posted automatically, 43 need a person, 0 await approval, 38 are not maintenance, and **All 106 rows accounted for**." (Numbers: `tests/server/sample-statement.test.ts :: "MP8 the mix: 106 rows, 25 posted automatically, 43 queued, 38 ignored, accounted, in well under a second (an illustration, not the benchmark)"`.) "Not maintenance means debits, interest and bank charges. The import is one database transaction: if the counts did not add up, nothing would be saved." (`src/server/statements/import.ts`, `isAccounted`.)

Be honest in one sentence: "This sample is built to show the screens. On a simulated benchmark of 20,000 rows only about 4% of credits post automatically, and none of the 610 that did was wrong." (`tests/fixtures/benchmark/dev/expected.json`, `tests/fixtures/benchmark/holdout/expected.json`.)

**Fallback:** if the sample button does nothing, upload any `.csv` with the columns `Txn Date, Narration, Credit, Debit` (`README.md`). If the page errors, show `docs/screenshots/reconciliation-import-1280.png` and say the same words. If the counts differ from 25/43/0/38, say why: Swati paid first, or `DEMO_AS_OF` is not set; the numbers follow the data, not the script.

## Step 3. Show an automatic match (1:40 to 2:20)

**Do (profile A):** open the **Posted** lane. Find the row for T12-0408, Swati Joshi, ₹6,468.

**Say:** "This one posted by itself. The narration has the flat code and her name, the amount is exactly what the flat owes today, and nothing else on the statement disagrees. A flat code alone is not enough: the matcher needs a second, independent signal (rule M4j)." "What it wrote to the ledger is a late fee of ₹98 and a payment of ₹6,468, and her bill is settled." (`tests/domain/billing/posting.test.ts :: "T12-0408 paid in full on 27 Oct: LATE_FEE ₹98 and PAYMENT ₹6,468"`; the matcher scenario is `tests/domain/matching/demo-scenarios.test.ts`, test name starting `T12-0408 paying 646800 with 'T12 408' and the resident's name is AUTO`.)

**Fallback:** if the row is not in Posted (for example Swati paid first), say "that row is queued here because the bill was already paid, which is the safe outcome", and move on. Or show `docs/screenshots/home-no-dues-1280.png`.

## Step 4. A queued row, then a second-approver case (2:20 to 3:30)

**Queued row. Do (profile A):** open **Needs you**. Press **Review** on the row for T21-1601, ₹5,660. Read the panel ("Why this needs you"). Under "Which flat paid?" choose T21-1601. In "Reason (required)" type, for example, `Principal only, payer named on the narration`. Press **Post to T21-1601**.

**Say:** "He paid the principal only. The matcher will not post a partial payment by itself: late fee would still be due, so a person decides, and must write a reason of at least 5 characters." (`reasonSchema` is 5 to 500 characters, `src/server/statements/manual-core.ts`.) "The result says what was posted: a payment of ₹5,660 and a late fee of ₹38, and ₹38 is still due." (`README.md`, step 3 of "Walking the reconciliation".)

**Second-approver case. Do (profile A):** still in **Needs you**, find one of the three credits of about ₹10,660 that show a flat code and a name (not the ₹10,720 row without a code). Press **Review**, pick the flat, write a reason, press **Post to <flat>**. The panel says it needs a second approver and the row moves to **Awaiting approval**, where Priya sees "Waiting for another approver". **Switch to profile B:** log in as Rahul Menon, 5000000002, open the same import, **Awaiting approval**, press **Approve**. The row appears in **Posted** as "Manual by Priya Nair, approved by Rahul Menon".

**Say:** "In the demo, credits of ₹10,000 or more need a second approver, a different person with the approve permission. The person who asked cannot approve their own request. The service refuses it, and the database has a constraint that refuses it too." (`tests/integration/manual-approval.test.ts :: "the person who asked cannot approve: SELF_APPROVAL from the service, before any database constraint, and nothing changes"`; the default threshold in the matcher is ₹25,000 and the demo setting is ₹10,000: `src/domain/matching/context.ts`, `src/domain/seed/settings.ts`.)

If you want to prove it live, press **Approve** as Priya on that row first: it should say "You asked for this, so another person has to approve it." (`src/lib/messages/en.ts`, `recon.approval.selfApproval`; whether Priya sees an Approve button at all is UNVERIFIED, she may only see "Waiting for another approver", which the README says she does.)

**Fallback:** if you cannot find the ₹10,660 rows, the exact position in the list is UNVERIFIED (the list is biggest credit first, so the ₹30,000 and ₹22,425 rows come before them). Use any queued credit of ₹10,000 or more that shows a flat code and one candidate flat. If Rahul's login fails, show `docs/staff-ui.md` and say the approval step is covered by `tests/integration/manual-approval.test.ts :: "a second person approves: the entries are posted, an APPROVED decision names requester and approver, the queue item is RESOLVED, the payer is remembered"`.

## Step 5. The resident Home and a payment (3:30 to 4:10)

**Do (profile C):** log in as Aamir Shaikh, 5000000009. The Home shows a late fee still due, "Late fee due ₹38" (`README.md`). Press **Pay ₹38** (the button text is "Pay {amount}"). On the "Demo payment page (mock gateway)" press **Pay successfully**. You return to the Home, which now says **No dues**.

**Say:** "The amount is locked when he taps Pay, so what he sees is what he is charged. This page stands in for a real payment provider; it charges nothing. It sends the same signed message a real provider would. The server checks the signature and a 5-minute time window, and posts only on confirmed success, once." (`src/server/payments/webhook.ts`, `TIMESTAMP_WINDOW_SECONDS = 300`; `tests/integration/payments-webhook.test.ts :: "ten parallel success events post exactly once: one POSTED, nine DUPLICATE, two ledger entries, one PAYMENT"`.) "A real provider is not connected, and the mock works only in demo mode."

**Fallback:** to show the failure path, press **Payment fails, no money taken** instead; the Home shows "That payment didn't go through. No money left your account." and Pay stays available. If the pay page fails, show `docs/screenshots/pay-demo-page-1280.png`. Whether the Home label for a fee-only bill reads exactly "Pay ₹38" is UNVERIFIED (the button text is built from `pay.button`); `docs/screenshots/home-fee-only-1280.png` shows that state. If Aamir is already settled because you skipped the Step 4 post, use Swati's flat instead and say so.

## Step 6. A safety complaint and its alert (4:10 to 4:50)

**Do (profile C):** log out, log in as Swati Joshi, 5000000007. Press **Complaints** in the bottom bar, then **Raise a complaint**. Answer **Yes** to "Is anyone in danger right now?". Type a short fictional text, for example `Smell of gas near the lift on floor 4`, and press **Send complaint**. Press Home: the alert above the dues reads "Your report has gone to the duty manager", with a filled **Call duty manager**. Log out and log in as Sanjay Pawar, 5000000005. `/staff` lists **Complaints**; open it. It lands on **Safety**; the new report is the first row, Critical, with the source "Rules". Open it and press **I have seen this**. Log in as Swati again: the Home says "The duty manager has seen your report".

**Say:** "Safety words in English, Hindi and Marathi, or a Yes to the danger question, escalate by rule. No AI model is called for these. The complaint is marked critical and goes to the duty manager. A model can never output critical." "There are 79 word rules. They have not been checked by a native speaker, which is why the Yes/No question exists." (`tests/integration/complaints-providers.test.ts :: "a safety complaint NEVER reaches a provider: zero requests, CRITICAL by rule"`; `src/domain/complaints/safety.ts`; `tests/domain/complaints/safety-review-doc.test.ts :: "says it is not verified by a native speaker, and has a column for who reviewed it and when, left empty"`.) "If nobody acknowledges within 5 minutes, the resident's screen changes to 'No answer yet' with a call link. Nothing else escalates; that timer is display only." (`src/domain/complaints/safety-alert.ts`; limits in `docs/walkthrough.md`, section 6.)

**Fallback:** if the staff board does not show the report, use the page address of the complaint (the id is in the URL of Swati's complaint page) and acknowledge it with the `curl` commands in `README.md`, "Raising a complaint (resident)", step 4. Or show `docs/screenshots/board-safety-1280.png` and `docs/screenshots/home-safety-alert-1a-1280.png`. If you are short of time, skip the acknowledgement and stop at the "gone to the duty manager" alert. Note that with `DEMO_AS_OF` set the 5-minute clock does not run (`README.md`).

## Step 7. End on the committee view (4:50 to 5:00 and beyond)

**Do (profile A or a new profile):** log in as Meera Kapoor, 5000000003. Open **Committee report**. Read the top line: "Figures as of 27 October 2026".

**Say:** "The committee reads one page. Billed equals Collected plus Outstanding, to the paisa, and the page opens only with the report permission. No resident names or phone numbers appear." The seeded October figures are Billed ₹1,80,52,190, Collected ₹1,48,42,714, Outstanding ₹32,09,476 (`tests/integration/committee-report.test.ts :: "the pristine seed gives these October figures, which scripts/smoke-app.mjs also expects (as of 27 Oct 2026): a drift in the seed shows here first"`; the same numbers are in `README.md`). If you did the earlier steps, the **Bank reconciliation** line now reflects the imported statement.

**Fallback:** show `docs/screenshots/report-top-1280.png`. The goals shown (90%, 90%, 8%) are assumptions, not agreed targets (`docs/committee-report.md`).

## If you have a minute left: what to say about limits

- The matcher was tested on simulated data, not a real bank.
- No real SMS sender, payment provider or deployment is evidenced in the repository. Login codes are shown in a banner only because this is demo mode.
- The classifier providers were never called live by this work; the keyword fallback answers if none is configured.
- The 79 safety rules are not reviewed by a native speaker.

## If everything fails live

Show the last known test results instead of running them live: `npm run check` passed 4203 unit tests (1 skipped) and `npm run test:ci-parity` passed 1035 integration tests in 71 files on 2026-11-07, and open `docs/walkthrough.md` and `docs/screenshots/`.
