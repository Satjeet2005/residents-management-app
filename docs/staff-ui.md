# Staff screens: bank reconciliation (T12c)

The screens over the T12a import and the T12b manual services. They show what the server decided, let a person decide what it could not,
and add no money rule of their own: every posting goes through the routes of `docs/manual-reconciliation-design.md`. Decisions: D114,
D115, D116 (`docs/decisions.md`), with D14, D55, D81, D103 to D109 behind them. The look is Passbook (`docs/design-system.md`).

## Pages

| Address | Who | What it shows |
|---|---|---|
| `/staff` | any active staff | The tools the person may open ("Bank reconciliation" with `payments:match`), their permissions in words, sign out. |
| `/staff/reconciliation` | `payments:match` | "Upload a bank statement" (a .csv, its name and size, Import; in demo mode also "Use the sample statement") and "Recent imports": date, file, rows, posted, need you, ignored and the books check, each linking to its workspace. |
| `/staff/reconciliation/[importId]` | `payments:match` | The workspace of one import. `?lane=needs-you\|awaiting-approval\|posted\|not-maintenance` picks the lane, `?row=<id>` opens a row. |

Every page calls `requireUser({ need: ... })` itself (a layout does not run again between pages). The data loaders in
`src/server/statements/ui-data.ts` check the permission again at the data (`StaffAccessError`), and the load-more server action is built with
`withPermissionAction("payments:match")`. A resident, staff without `payments:match` and nobody signed in are turned away
(tests: `tests/server/page-guards.test.ts`, `tests/integration/staff-ui-data.test.ts` UD3 and UD7, `scripts/smoke-app.mjs`).

## The workspace

1. **Header.** The file name (the only h1), when it was imported and by whom.
2. **Summary bar.** A segmented bar and, under it, the same numbers in words: Posted automatically, Need you, Awaiting approval, Not
   maintenance, and Posted by hand and Already imported when above zero (never colour alone). Widths are whole numbers that add up to 100 (largest
   remainder), and a count above zero is never zero wide (`barWidths`). Under a double rule: "All N rows accounted for" with a check, drawn
   only when the `accounted` flag READ BACK FROM THE DATABASE (`getStatementSummary`) is true. Otherwise "The counts do not add up. Do not post
   from this import." and no action is offered anywhere (the panel keeps the facts and switches the actions off).
3. **Lanes.** A tablist (arrow keys, Home, End). Each tab is a link, so the lane is in the URL and it works without a script.
4. **Rows.** A real table from 768px, stacked cards below: date, amount (tabular figure), narration cut to 60 characters, the best candidate
   flat as a chip and a confidence tag ("High", "Medium", "Low", "No match"). Biggest amount first, then a keyset "Load more" (25 at a time)
   through a server action.
5. **Review panel** (`?row=`): docked at the right from 1024px, a full-screen sheet below (the page behind is inert there). It holds the bank
   facts with the full narration, "Why this needs you" (the stored reasons), the candidates as radio options (flat code, residents, open
   positions with kind, due date and amount due, and how the credit compares in words), "Choose another flat" (search, 2 characters, results
   in the same radio group), a required reason (5 to 500 characters, with a counter), "Remember this payer's UPI id for this flat" only when
   a UPI id exists, the second-approver notice, **Post to <flat>** (disabled until a flat and a valid reason; nothing is preselected) and
   the outlined **Not a maintenance payment** (asks for a reason). After a success it says what was posted (each entry's type and amount,
   "₹38 late fee still due") and offers the next row. Refusals are plain sentences: 409 STALE or STATE_CHANGED "This row changed. Reload to see
   its current state." with Reload; 422 NEEDS_ADVANCE_HANDLING, NO_OPEN_BILL, REASON_REQUIRED, FLAT_NOT_FOUND each their own; a network error
   with Try again. A submit in flight blocks a second one.
6. **Awaiting approval.** Who asked, what (match to a flat or ignore), the reason and when. Another person with `payments:approve` sees Approve
   (optional note) and Reject (reason required), each opening a small form so one tap decides nothing. The requester, and anyone without
   `payments:approve`, sees "Waiting for another approver" and no buttons (`approvalView`). The server refuses the rest again (SELF_APPROVAL, 403).
7. **Posted** and **Not maintenance** are read only: the flat, "Automatic" or "Manual by <name>" (and who approved), the entries posted;
   the ignore kind or the reason. No undo.
8. **States.** Skeletons while loading (`loading.tsx`, no h1), empty lanes ("Nothing needs you. Every row is accounted for."), an error boundary
   with Try again that never prints the error, and a not-found page for an import address that matches nothing.

## The threshold (D116)

The notice reads "This needs a second approver. It will wait in Awaiting approval. Credits of ₹10,000 or more need a second approver." and
the amount comes from `society_settings.approval_threshold_paise` through `loadReview` (`thresholdPaise`), never from a number in the screen
(`tests/ui/staff-rules.test.ts` SR3 fails if one is written in). The demo's setting is ₹10,000; the matcher's default and the benchmark stay at
₹25,000 (`docs/matching-benchmark.md`).

## What is deliberately absent

| Absent | Why |
|---|---|
| **Undo** of a posting | A posting is corrected by a person with a new entry, later (`docs/manual-reconciliation-design.md`). The `UNDO` decision exists in the enum and is unused. |
| **Accept all** and any **bulk action** | Every manual decision needs a person and a reason of its own (D114). A test fails if the words appear anywhere in the staff source or the catalog. |
| **Advance credit** and a payment for several bills | A credit above the oldest position's amount due is `NEEDS_ADVANCE_HANDLING`; the panel says so and the row stays in Needs you. |
| **Waivers** of a late fee | The fee stays owing (D107); a waiver would be a separate, approved workflow. |
| Hindi and Marathi | Out of this task. (The committee report is `docs/committee-report.md`; complaints are `docs/staff-complaints-ui.md`.) |

## How the data is read

```
requireUser({ need: "payments:match" }) -> loadWorkspace / loadImportList / loadReview / loadRowCards (ui-data.ts) -> pure views
```

The loaders call the T12b services (`listRows`, `listImports`, `getRowReview`, `getStatementSummary`) and add only SELECTs the app role already has
(`bank_rows`, `payment_matches`, `ledger_entries`, `users`, `society_settings`): no privilege was added. Money crosses to the client as decimal strings.
The decisions go to the existing routes (`/api/bank-rows/[id]/match|ignore|approve|reject`, `/api/flats/search`, `/api/statements`, `/api/statements/sample`)
with the row's `version`, so a row someone else changed is refused (STALE) and not overwritten.

## Assumptions (labelled)

- **U1.** Posted by hand is its own segment of the summary bar, shown above zero. The task lists four segments; without it the bar would not add up
  to the rows read once a person has posted one.
- **U2.** Nothing is preselected in the panel, not even the matcher's best candidate: choosing a flat is the decision, and the reason is required.
- **U3.** Only rows in Needs you open the panel from the list. Another lane's row has no link (nothing there can be done to it, or, for approvals,
  the controls are in the row). A `?row=` of a row that is no longer waiting shows its facts and "This row is not waiting for you any more."
- **U4.** After a success the panel stays to show what was posted and offers "Go to the next row" (the next in the list, else the one before).
- **U5.** The sheet below 1024px is a full-screen `aside` with the page behind it `inert`, not a native `<dialog>`; Escape and the Close button close it.
- **U6.** The task's "All 105 rows accounted for" is "All 106 rows" since D116 changed the sample statement.
- **U7.** Approve and Reject open a form before sending; the confirm button is filled, so several open forms in one lane could show several filled
  buttons. Nothing stops two people, or one person with two forms open, from deciding two rows.

## What is not tested here

The look at 1280px and 360px, the focus ring, where focus lands, the sheet's scrolling and the arrow keys on the tabs need a person and a browser (the
commands are in the README, "Walking the reconciliation"). The render tests (`tests/ui/reconciliation-*.test.ts`) check the markup for each state; the
reducer and the labels are unit tested (`tests/lib/reconciliation/`); the loaders run as the app role (`tests/integration/staff-ui-data.test.ts`); the
whole thing over HTTP is `scripts/smoke-app.mjs`. A click is not simulated anywhere: no DOM library is installed and none was added.

## UI batch 1: staff home and workspace (D186 to D192)

The staff home, its titles, strips and cards are described in `docs/ui-audit-staff-home.md`; the workspace's selector, rows and Filters sheet in `docs/ui-audit-reconciliation.md`. In short: the lane names appear once (the selector) and its counts are the unfiltered lane totals; a row of Needs you is one tappable card; sort, amount and reason are in the address; the amount words come from the society's approval threshold, never a fixed number; the reason groups are the table in `docs/manual-reconciliation-design.md`.
