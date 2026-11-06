# UI architecture (T11a)

The login screen, the app shell, Profile and the read-only resident Home. This page says how the screens are built, where
the data comes from, which clock they use, and what is deliberately **not** here yet and which task adds it. The look is
in `docs/design-system.md` (Passbook). No screenshots exist in the repository (`docs/design/passbook/` is empty), so the
screens were built from that text and the existing components.

## Pages

| Address | File | Who | What it shows |
|---|---|---|---|
| `/login` | `src/app/login/` | anyone | Phone, then one code field. Handles every answer of `/api/auth/otp/*`. A signed-in person is sent on. |
| `/` | `src/app/(resident)/page.tsx` | resident (a staff member is sent to `/staff`) | The Home: flat, dues, complaint, visitors, recent activity, Emergency. |
| `/profile` | `src/app/(resident)/profile/` | resident | Name, phone masked to the last 4 digits, role, current flats, sign out here or everywhere, the demo note (demo mode only). |
| `/staff` | `src/app/(staff)/staff/` | staff | Name and permissions, sign out. No links: no staff feature exists yet. |
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
  which has no loading page, answers a real **307**. No data is in the 200 body (the smoke test checks that). A true 307 for
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
4. `HomeView` draws it. It decides nothing about money. Every visible string is a key in `src/lib/messages/en.ts`, read with `t()`; dates
   are formatted by `src/lib/format-date.ts` (no Intl).

The queries run with the SELECT grants of the app role only (`docs/deployment-plan.md`, matrix); `tests/integration/home.test.ts` runs
them through a client that logs in as that role. **No privilege was added.**

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
| Pay (button, sheet footer, payment states) | The payment flow is not built | The payment task (D33, D34, D36) |
| View ledger, Receipt | Their pages do not exist | The ledger page task (optional, behind a flag) |
| Bills and Complaints pages, and their navigation items | The pages do not exist (`enabled: false` in `src/lib/nav.ts`) | The bills and complaints tasks |
| Raise a complaint, confirm or reopen, safety alert | Complaint actions are not built | The complaints task |
| Notifications bell (D22, D55) | Not built | The notifications task |
| Offline banner, service worker | A later task | The installable-app task |
| Hindi and Marathi UI, the language choice (D44) | English only for now (D2) | The translation task, if time allows |
| Staff features (matching queue, approvals, reports) | Not built | The staff tasks |
| A Proxy (true 307 for resident pages) | See above | Not planned |

Every control on screen works; every control that would not is not drawn.

## What is not tested

`getCurrentUser`, the `headers()` reads and the Next.js redirect plumbing need a running request, so they are checked by the HTTP smoke test
(`npm run smoke:app`, run against the built app, frozen and with the real date) and not by unit tests. The visual look (spacing at 360px and 1280px)
cannot be tested here: it needs a person to look (see the commands in the T11a report and the README).
