# UI architecture (T11a, T11b, T13b, T13c, T14)

The login screen, the app shell, Profile and the resident Home with its Pay flow (T11b). This page says how the screens are built, where
the data comes from, which clock they use, and what is deliberately **not** here yet and which task adds it. The look is
in `docs/design-system.md` (Passbook). T11a was built from that text alone; T11b compared the screens with the images in
`docs/design/passbook/` and matched them (D98). Where an image disagrees with the text rules, the rules win: the image shows a single
heavy line under the amount (the rule is the double rule), a notifications bell (not built, D55), and a filled call button inside
the Emergency sheet (the call link there is the large accent link the task describes).

## Pages

| Address | File | Who | What it shows |
|---|---|---|---|
| `/login` | `src/app/login/` | anyone | Phone, then one code field. Handles every answer of `/api/auth/otp/*`. A signed-in person is sent on. |
| `/` | `src/app/(resident)/page.tsx` | resident (a staff member is sent to `/staff`) | The Home: flat, dues with Pay, complaint, visitors (times only), recent activity, Emergency. |
| `/complaints` | `src/app/(resident)/complaints/` | resident | The complaints list: open first, closed collapsed (T13b, `docs/complaints-ui.md`). |
| `/complaints/new` | `.../complaints/new/` | resident | The form with the danger question (D121, D127). |
| `/complaints/[id]` | `.../complaints/[id]/` | resident, own flat (another flat's id is the not-found page) | One complaint: tracker, timeline, confirm or reopen. |
| `/pay/mock/[attemptId]` | `src/app/(demo)/pay/mock/[attemptId]/` | resident, own flat, demo mode only (404 otherwise) | The demo payment page of the mock gateway (D100). |
| `/profile` | `src/app/(resident)/profile/` | resident | Name, phone masked to the last 4 digits, role, current flats, sign out here or everywhere, the demo note (demo mode only). |
| `/staff` | `src/app/(staff)/staff/` | staff | Name, the tools the person may open, permissions in words, sign out. |
| `/staff/reconciliation` | `src/app/(staff)/staff/reconciliation/` | staff with `payments:match` | Upload a bank statement, recent imports (T12c, `docs/staff-ui.md`). |
| `/staff/reconciliation/[importId]` | `.../[importId]/` | staff with `payments:match` | The workspace: summary bar, lanes, rows, review panel. |
| `/staff/reports` | `src/app/(staff)/staff/reports/` | staff with `reports:view` | The committee report: money line, what is owed (with a drill-down), collection quality, complaints, the reconciliation line, the goals (T14, `docs/committee-report.md`). |
| `/staff/complaints` | `src/app/(staff)/staff/complaints/` | staff with `complaints:manage` | The board: six lanes, rows, Load more (T13c, `docs/staff-complaints-ui.md`). |
| `/staff/complaints/[id]` | `.../complaints/[id]/` | staff with `complaints:manage` | One complaint: full timeline and the action panel. |
| `/forbidden` | `src/app/forbidden/` | anyone | Plain message and a link home. Where `requireUser` sends a wrong role. |
| `/design` | `src/app/design/` | hidden unless `SHOW_DESIGN_PAGE=true` | The component reference. |

The two layouts (`(resident)`, `(staff)`) draw a frame and **check nobody**. Each page calls `requireUser` itself, as the
Next.js authentication guide says (a layout does not run again when a person moves between pages). `tests/server/page-guards.test.ts`
fails for a page that is neither on its public allowlist nor calls `requireUser`, and for a layout that does the check.

What Next.js says (the copy in `node_modules/next/dist/docs/01-app`, version 16.4.2, and https://nextjs.org/docs/app/guides/authentication, updated 2026-09-16):

- Check the session in each page, close to the data; a Proxy is optional and cookie-only. We add none.
- **Streaming and redirects** (`03-api-reference/03-file-conventions/loading.md`, "Status codes"): "Streaming page responses begin with a
  200 status code", and `redirect()` in a streaming context "will insert a meta tag to emit the redirect on the client side"
  (`04-functions/redirect.md`). Because the resident pages have a `loading.tsx`, a request for `/`, `/profile` without a session
  answers **200** with the loading skeleton and a `<meta http-equiv="refresh" content="1;url=/login?returnTo=...">`; `/staff`,
  which has no loading page, answers a real **307**. The reconciliation pages have a `loading.tsx`, so they answer **200** with a meta refresh to
  `/forbidden` or `/login` (the smoke test follows either). No data is in the 200 body (the smoke test checks that). A true 307 for
  the resident pages would need a Proxy that checks the cookie first (the same page says to run the check before the body streams
  to get the status); that is left out on purpose, and the page-level check stays the one that matters.
- `searchParams` of a page is a Promise in Next.js 16 (`page.md`); the login page awaits it.
- A document that streams a fallback and the page together contains both. `loading.tsx` therefore has no `<h1>` (the smoke test found
  two): the page that replaces it has the only one.

## Data flow of the Home

```
requireUser()  ->  getHomeData({ db, user, now: businessNow() })  ->  HomeView(data)
   (session)        src/server/home/                                   (pure, src/app/(resident)/home-view.tsx)
```

1. `requireUser` (src/server/auth/current-user.ts) reads the session from the database. No session: redirect to
   `/login?returnTo=<safe path>`. Wrong role: `/forbidden`.
2. `getHomeData` (`src/server/home/home-data.ts`) reads the person's **own** current memberships (`queries.ts`, one file, SELECTs only),
   takes the first flat by code, then that flat's bills, ledger entries, open complaints, today's visitors, and the settings. The flat
   id comes from nothing but the session user's memberships: no flat code or id from a request is accepted.
3. The pure mapper `assembleHome` (`mapper.ts`) turns the rows into plain data (`types.ts`): strings, numbers, bigint paise, date
   texts, epoch milliseconds. Dues come from `computeDues` (`src/domain/billing/dues.ts`) which calls `computeLateFee` on the
   society's validated `late_fee_policy`; the exact working of the fee is `buildFeeWorking` (`working.ts`). A missing or invalid policy
   is an error, never a guess.
   A bill is open while its position is `PRINCIPAL_OPEN` or `FEE_ONLY` (`positionsForFlat`, D107). The dues status is
   `LATE_FEE_DUE` when only fees are owed.
4. `HomeView` draws it. It decides nothing about money. Every visible string is a key in `src/lib/messages/en.ts`, read with `t()`; dates
   are formatted by `src/lib/format-date.ts` (no Intl).

The queries run with the SELECT grants of the app role only (`docs/deployment-plan.md`, matrix); `tests/integration/home.test.ts` runs
them through a client that logs in as that role. T11b adds two more reads (the newest payment attempt of the flat and the
`society_bank_account` setting) and no privilege for them. A visitor's name is not read at all: the Home shows a count and the times.

## The Pay flow (T11b, D98 to D102)

```
Home: [Pay ₹X] -> POST /api/payments {expectedAmountPaise} -> 200 {checkoutPath} -> /pay/mock/<id> -> a button
                                                          -> 409 AMOUNT_CHANGED: show "The amount changed to ₹Y. Tap Pay again." and refresh
                                                          -> 503 / network / 5xx: a message and Try again
demo page button -> server action -> signed event -> verifyWebhook -> applyGatewayEvent -> redirect "/"
```

- `src/app/(resident)/dues-sheet.tsx` (`DuesActions`, a client component) holds one payment state shared by the Home button and the
  sheet's sticky footer, posts the amount on screen as a decimal string, and ignores taps while loading. `src/lib/pay.ts` is the
  pure part: `interpretPayResponse`, `payLabel` ("Pay oldest bill ₹X" only with more than one open bill, D99).
- `pay-control.tsx` draws the button in each state; `bank-transfer-panel.tsx` has the payment note chip, the copy button with a visible
  "Copied", and the society's account as given by the setting.
- **Late fee due (D107).** When the oldest open bill's principal is paid and only its fee is owed, the tag says "Late fee due", the
  label is the usual "Amount due, as of <date>", the button is "Pay ₹<fee>", and the breakdown lists "Bill issued, <Month>, paid in
  full", its payments (a part payment of the fee is one of them) and "Late fee, accrued until <the day the principal was paid>",
  with the working as of that day. The fee does not grow, so there is no "grows by about" line. The strings are catalog keys.
- After a success the Home reads the ledger and shows "No dues" with the late fee and payment lines in Recent activity. After a failure
  the Home shows a strip above the dues while the newest attempt FAILED within 24 hours (`paymentNoticeOf` in `mapper.ts`).
- The demo page is in its own `(demo)` route group. A page behind `loading.tsx` streams, so a `notFound()` or `redirect()` after
  that starts as a 200 and is only drawn by the browser (see the finding above for `/`); outside it they are a real 404 and 307.
- What the Next.js docs say that this relies on (the copy in `node_modules/next/dist/docs/01-app`, version 16.4.2, read 2026-11-06):
  a Route Handler reads a webhook body with `request.text()` and needs no body parser (`route.md`, "Webhooks"); a Server Action is
  reachable by a direct POST, so each one re-verifies the person and the resource it acts on (`data-security.md`, "Authentication and
  authorization"); `redirect()` and `notFound()` work inside Server Functions (`redirect.md`, `not-found.md`).

## Two clocks (D97)

- **Real clock**: login, sessions, rate limits, audit rows. Always `Date.now()`.
- **Business clock** (`businessNow()` in `src/server/clock.ts`): what is due today, days overdue, today's visitors, reply times. It is
  the real India date, unless the optional `DEMO_AS_OF` (YYYY-MM-DD) is set, and then it is 12:00 India time on that date. `DEMO_AS_OF` is
  for tests and for a reviewer who wants the brief's sample numbers locally. **The live deployment leaves it unset.** The screens always
  say the date used ("As of 27 Oct"; "Amount as of 27 Oct 2026" in the sheet).

### The demo data note

The seed is anchored to 27 October 2026 (`DEMO_AS_OF` in `src/domain/seed/types.ts`). With today's real date the numbers move: more days overdue,
a bigger late fee, visitor passes of 27 October are no longer "today", some replies show as overdue. So, **only when `DEMO_MODE` is exactly
`"true"`**, a calm note ("About this demo data") is shown under the login form and on Profile, saying so and how to reproduce the brief's
numbers (`DEMO_AS_OF=2026-10-27`). It is never shown otherwise (tests: `tests/ui/login-view.test.ts`, `tests/ui/shell-view.test.ts`, and the smoke test).

## What is deliberately absent, and who adds it

| Absent now | Why | Added by |
|---|---|---|
| Payment in flight (PROCESSING, UNKNOWN, RELEASED) variants of the dues, "Contact accounts" | Only INITIATED, SUCCEEDED and FAILED exist | The next payment task (D33, D36, D52) |
| View ledger, Receipt | Their pages do not exist | The ledger page task (optional, behind a flag) |
| Bills page and its navigation item | The page does not exist (`enabled: false` in `src/lib/nav.ts`) | The bills task |
| Complaint screens, the safety alert | Built in T13b (`docs/complaints-ui.md`) | |
| Notifications bell (D22, D55) | Not built | The notifications task |
| Offline banner, service worker | A later task | The installable-app task |
| Hindi and Marathi UI, the language choice (D44) | English only for now (D2) | The translation task, if time allows |
| Charts, export and print views of the committee report | Not built (the ageing is a segmented bar of plain elements) | Not planned (`docs/committee-report.md`). Bank reconciliation (`docs/staff-ui.md`), the complaints board (`docs/staff-complaints-ui.md`) and the committee report are built |
| A Proxy (true 307 for resident pages) | See above | Not planned |
| Waiving a late fee | A waiver is a separate approved workflow; today a fee stays owing until paid (D107) | A later task, if the committee wants it |

Every control on screen works; every control that would not is not drawn.

## What is not tested

`getCurrentUser`, the `headers()` reads and the Next.js redirect plumbing need a running request, so they are checked by the HTTP smoke test
(`npm run smoke:app`, run against the built app, frozen and with the real date) and not by unit tests. The visual look (spacing at 360px and 1280px)
cannot be tested here: it needs a person to look (see the commands in the T11a report and the README).

## Staff screens (T12c)

Bank reconciliation is built over the T12b services; `docs/staff-ui.md` has the pages, the workspace, the assumptions and what is absent
(undo, accept-all, advance credit, waivers). Pure logic sits in `src/lib/reconciliation/` (lanes, the summary bar, the review panel's reducer,
labels, who sees Approve), the loaders in `src/server/statements/ui-data.ts`, and the screens in `src/app/(staff)/staff/reconciliation/`. The staff
frame (`src/app/(staff)/layout.tsx`) is a banner with one link home and checks nobody. A client component receives only plain data (money as
decimal strings) and talks to the existing API routes; the one server action ("Load more") is built with `withPermissionAction("payments:match")`.

## Committee report (T14)

The committee report is in `docs/committee-report.md`. Same shape as the other staff screens: the page calls `requireUser({ need: "reports:view" })`, `loadCommitteeReport` (`src/server/reports/report-data.ts`)
checks the permission again and reads through the app role, and pure views draw the data. The money comes from `positionsForFlat`, the Home's function, over every flat in three queries, and the pure
metrics are in `src/domain/reports/`. The page is almost all server components: the month selector is a plain GET form (it works without a script and the month is in the address), and the only client
component is the ageing drill-down's "Load more" (a server action built with `withPermissionAction("reports:view")`). The blocks are a grid, two columns from 1024px and stacked below. Nothing on the
page names a person.

## Staff complaint screens (T13c)

The board, one complaint with its full timeline and the action panel are in `docs/staff-complaints-ui.md`. Same shape as the reconciliation screens: the page
calls `requireUser({ need: "complaints:manage" })`, a loader in `src/server/complaints/staff-page-data.ts` checks the permission again and reads through the
app role, a pure view draws the data, and two client components hold the state: the lane tabs (arrow keys, the lane in the address) and the action panel (a
reducer from `src/lib/staff-complaints/panel.ts` that calls the existing staff routes). The one server action ("Load more") is built with
`withPermissionAction("complaints:manage")`. The loaders run auto-close lazily and quietly (D120).

## Complaint screens (T13b)

The complaints list, the raise form, one complaint and the Home safety alert are in `docs/complaints-ui.md`. They follow the same shape as the Home: the
page calls `requireUser({ need: "RESIDENT" })`, a loader in `src/server/complaints/page-data.ts` (or `getHomeData`) reads through the app role, a pure
view draws the data, and a client component (the form, the answer buttons) holds a reducer from `src/lib/` and calls the existing routes. The Home's
loader runs auto-close lazily and adds `safetyAlert`; while it is set the Pay buttons are outlined. The resident pages stream under
`(resident)/loading.tsx`, so a not-found page for a complaint of another flat is a 200 response with the not-found page and a `noindex` tag.
