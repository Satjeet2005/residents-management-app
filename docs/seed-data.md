# Demo dataset

`generateDemoDataset()` in `src/domain/seed` builds the data the demo app runs
on. It is pure and deterministic: the same seed gives the same dataset, with no
`Math.random`, clock, `Intl` or Node built-ins. Rows have string keys such as
`flat:T12-0408`; a later database writer maps keys to UUIDs. The default seed is
`20261027` and the demo's "today" is `2026-10-27`.

```ts
const dataset = generateDemoDataset();            // default seed
const other = generateDemoDataset({ seed: 42 });  // different random content
```

The default dataset has 2,400 flats, 3,434 users (5 staff), 3,429 flat members,
11,999 bills, 25,579 ledger entries, 3,450 complaints with 22,835 events, 316
visitor passes, 720 known payers and 402 notifications, and takes about 200 ms
to build.

## All data is fictional

- No real person, phone number, address, bank reference or UPI id is used.
- Names are common Indian first names combined with common surnames. A
  combination can coincide with a real person's name; no real person is meant.
  The sample residents' names and the staff names are reserved, so the random
  names never repeat them.
- **Phone numbers** are 10 digits and start with **5**, counting up from
  `5000000001` in creation order. Real Indian mobile numbers start with 6, 7, 8
  or 9, so none of these can belong to a real person. The app accepts these
  numbers only in demo mode.
- Payment references look like `SEED-UPI-T12-0408-2026-08-01`. They never use a
  real UPI or bank format.

## Design

| Piece | Rule |
|---|---|
| Random numbers | mulberry32 (`prng.ts`). `fork(label)` derives a new generator from the seed and a label, not from how many numbers were drawn, so one flat's data never changes because another flat drew more. Each bill's payment behaviour uses its own fork. |
| Flats | 28 towers `T01` to `T28`; 20 towers have 86 flats and 8 have 85 (the 8 are chosen by the seed), 2,400 in all. Code `T{tower}-{floor}{unit}`, floors 01 to 16, units 01 to 08. Slots are chosen per tower by the seed; the sample flats are always included. |
| Areas | Quota-based, not independent draws, so the mean does not depend on the seed. |
| People | 1 to 2 members per flat. About 18% of flats are tenanted. Staff are users with role `STAFF` and are not flat members. |
| Bills | Periods June to October 2026. Bill amount = area x 650 paise. Issued on the 1st, due on the 10th (one exception below). |
| Ledger | Posted as decisions D13, D26 and D35 require; see below. |

### Area weights

Sizes are filled by quota (largest remainder), then shuffled across flats. The
weights are percentages of the 2,400 flats, so each quota is a whole number.

| Area (sq ft) | 650 | 750 | 850 | 980 | 1150 | 1320 | 1500 | 1640 | 1850 |
|---|---|---|---|---|---|---|---|---|---|
| Weight | 4 | 7 | 11 | 18 | 22 | 17 | 12 | 7 | 2 |
| Flats | 96 | 168 | 264 | 432 | 528 | 408 | 288 | 168 | 48 |

The mean is exactly **1,157.6 sq ft** for every seed. Forced flats take their
areas from the quota of that size.

### Payment behaviour

Probabilities per bill, for flats that are not forced. On time means paid between
the issue date and the due date inclusive; late means paid after the due date but
not after the demo date; partial is one payment of 40% to 70% of the bill; unpaid
has no payment.

| Period | On time | Late | Partial | Unpaid |
|---|---|---|---|---|
| October | 0.70 | 0.10 | 0.04 | 0.16 |
| September | 0.72 | 0.18 | 0.03 | 0.07 |
| August | 0.74 | 0.20 | 0.02 | 0.04 |
| July | 0.75 | 0.22 | 0.01 | 0.02 |
| June | 0.75 | 0.23 | 0.01 | 0.01 |

- On-time payment dates: the day offset from the 1st is drawn with the first five
  days (offsets 0 to 4) five times as likely as each of the last five.
- Late payment dates: uniform from the day after the due date to the earlier of
  due + 45 days and the demo date.
- Partial payments: a whole-percent share from 40 to 70, rounded half up to whole
  rupees, dated uniformly from the issue date to the earlier of due + 20 days and
  the demo date. The rest stays unpaid.

Observed for the default seed, October, over the 2,393 non-forced flats:
on time 70.46%, late 9.53%, partial 4.30%, unpaid 15.71%.

### Ledger posting (D13, D26, D35)

The late fee is computed, never stored, and is posted only at settlement.

- Every bill gets a `BILL` charge on its issue date.
- On-time full payment: one `PAYMENT` for the bill amount on the payment date.
- Late full payment: a `LATE_FEE` charge equal to `computeLateFee` as of the
  payment date (no payments, no holds), then one `PAYMENT` for bill plus fee on
  the same date. If the fee were 0, no `LATE_FEE` entry would be posted.
- Partial payment: one `PAYMENT` and no `LATE_FEE`.
- Unpaid: nothing further.

### Forced scenarios

These use no random draws, so they are identical on every seed.

| Flat | Area | Scenario |
|---|---|---|
| T12-0408 | 980 | June, July, August paid on time (August on 2026-08-05 for 637000); September unpaid, due 2026-09-10; no October bill. Tenant Swati Joshi, owner Anil Joshi. |
| T21-1601 | 1640 | June to September paid on time; October bill issued 2026-10-01, **due 2026-10-09**, 1066000; one payment of 500000 on 2026-10-12. Owner Aamir Shaikh. |
| T07-1203 | 1150 | June to October all paid on time; October payment 747500 on 2026-10-03. Owner Neeraj Kulkarni. |
| T15-0902 | 1320 | June to August paid on time; September and October both unpaid. Owner Rohit Deshmukh. |
| T03-0702, T18-1105, T26-0301 | 1640 | June to September paid on time; October unpaid (1066000), so one 10,660 cheque could match three flats. |

Amounts due as of 2026-10-27, worked with `computeLateFee`: T12-0408 646800,
T21-1601 569800, T07-1203 0, T15-0902 1,734,100 (two bills, 47 and 17 days
overdue), and 1,072,000 for each of the three cheque flats.

## Assumptions

- **A1.** Areas are filled by quota rather than independent draws, so the mean is
  fixed. The seed changes only where each size lands.
- **A2.** Which 8 towers have 85 flats, and which slots a tower uses, come from
  the seed. The sample flats are always among them.
- **A3.** A flat's `tower` is `T12` and its `number` is `0408`.
- **A4.** An owner-occupied flat has an `OWNER` and, with probability 0.45, a
  `FAMILY` member who shares the owner's surname. A tenanted flat has a `TENANT`
  and, with probability 0.4, an `OWNER` (a landlord who does not live there), as
  T12-0408 does. "About 18% tenanted" is the share of flats with a `TENANT`
  member (17.29% for the default seed).
- **A5.** Owners start on a date from 2015-01-01 to 2024-12-31, tenants from
  2025-01-01 to 2026-05-31, family members on the owner's date. `endsOn` is null
  for everyone. All users are active.
- **A6.** Phones: staff take `5000000001` to `5000000005`, the five sample
  residents `5000000006` to `5000000010`, everyone else follows in flat order.
  The sample residents' phones therefore do not change with the seed; the other
  residents' phones can.
- **A7.** Forced on-time payments are dated the 5th of the month (the 3rd for
  T07-1203) and use UPI.
- **A8.** Random payments use UPI 70%, NEFT 20% or cheque 10%; the mode appears
  only in the reference.
- **A9.** A part payment can fall before the due date, because its window starts
  at the issue date.
- **A10.** The `BILL` entry's key is `bill:{code}:{period}`, the same string as
  its bill's key; keys are unique per kind of row. `PAYMENT` and `LATE_FEE` keys
  start with `payment:` and `latefee:`, idempotency keys with `seed:`. `note` is
  always null.
- **A11.** A bill that is unpaid or part-paid in an earlier month stays open, so
  it keeps accruing a computed fee. By the table above that is about 2% (June),
  3% (July), 6% (August) and 10% (September) of the non-forced bills.
- **A12.** The tests call a flat's amount due the sum, over its bills with
  something outstanding, of the outstanding amount plus the computed fee. A
  settled late bill's fee is already in the ledger and is not charged again.

## Complaints, visitors, payers and notifications

All of this is fictional, like the rest. **Complaint text is English only. Hindi
and Marathi text has not been written or reviewed by a native speaker, so none
is included.**

"Now" is `DEMO_NOW` = 2026-10-27 12:00 IST (epoch milliseconds, built from
`dayStartInstant`). `DEMO_AS_OF` stays `2026-10-27`. Every timestamp is epoch
milliseconds and lies between 2026-09-01 00:00 IST and `DEMO_NOW`; the only later
times are visitors expected later today.

### Design

| Piece | Rule |
|---|---|
| Plans | Each complaint is a *plan*: its fixed facts and the times of each step (assigned, first response, resolved, closed, reopened ...). A step after `DEMO_NOW` is null, and so is every later step. `materialise()` turns a plan into the row and its events, so they cannot disagree. |
| Quotas | Category counts (and urgency counts of the ordinary complaints) are filled by quota and shuffled, like areas, so shares do not drift with the seed. Forced, cluster and safety complaints are counted first and taken off the quota. |
| Random | One forked generator per complaint (`complaint:bulk0001`), per incident, per flat (visitors, payers) and per user (notifications). |
| Settings | The 11 keys in the task, in `settings.ts`. The SLA minutes there are the ones complaints use. Phones `5900000001` and `5900000002` start with 5 and are above every user phone. `emergency_services_phone` is null (to be configured). |
| Routing | `assigneeFor()`: safety complaints go to Sanjay Pawar (duty manager), everything else to the category's default assignee, Kavita Rao. A NEW complaint has no assignee. |

### Target metrics, and what the default seed gives

| Metric | Target | Observed |
|---|---|---|
| Complaints | 3,300 to 3,600 (about 1,800 a month) | 3,450 (1,847 in September, 1,603 in the 27 days of October) |
| PLUMBING / ELECTRICAL / HOUSEKEEPING / LIFT / OTHER | 28.7 / 22.6 / 18.2 / 16.0 / 14.5%, each within 2 points | 28.7 / 22.6 / 18.2 / 16.0 / 14.5% |
| NORMAL / HIGH / LOW / CRITICAL | about 70 / 15 / 12 / 1% | 71.7 / 14.7 / 12.7 / 0.9% |
| Safety share | 0.5% to 1.5% | 0.9% (31) |
| Median first response | 60 to 120 min | 97 min |
| First response within SLA | 82% to 90% (about 86%) | 85.8% |
| Not closed at `DEMO_NOW` | 8% to 12% | 8.4% (CLOSED 91.6, PENDING 4.8, IN_PROGRESS 2.5, ASSIGNED 0.8, NEW 0.1, REOPENED 0.2) |
| CONFIRMED among closed non-safety | 72% to 84% | 76.5% (the rest AUTO_CLOSED) |
| Reopen rate among resolved | 8% to 14% | 11.1% |
| Older than 10 days and not closed | none, except a few REOPENED | none |
| Duplicate incidents | 12, 9, 7, 6, 5, 4 | 6 incidents, 37 links; 16 affected-too rows in 3 incidents |

The same generator over seeds 1 to 4 gives 8.7% to 9.6% not closed, a median
response of 93 to 96 minutes, 86.3% to 87.2% within SLA, 9.7% to 11.5% reopened
and 76.1% to 78.2% CONFIRMED.

### How a complaint's life is drawn

- **First response** is a staff action after creation. Buckets are chosen so the
  median is about 95 minutes. 16% of NORMAL and HIGH responses miss the SLA; LOW
  responses never do (see A15).
- **Resolved** (`PENDING_CONFIRMATION`) is at most 3 days after creation (about
  2 days if the complaint will be reopened), so that a complaint older than 10
  days is always finished: 3 days to resolve plus the 7-day auto-close is 10.
- **Closure**: `CONFIRMED` (a resident confirms 2 hours to 3 days later, rating
  1 to 5 skewed to 4 and 5) or `AUTO_CLOSED` (exactly 7 days after
  `pending_confirmation_at`, no rating).
- **Reopen**: 11% of complaints are drawn as reopened. Their first trip always
  ends CONFIRMED; the resident reopens 2 hours to 2 days later, and the second
  trip ends CONFIRMED with a rating. The row then shows `reopen_count` 1 and the
  last trip's `pending_confirmation_at`, `closed_at` and rating. A reopen that
  falls after `DEMO_NOW` is not drawn; one still open is `REOPENED`.
- **Safety**: CRITICAL, due in 15 minutes, `RULE` classification, `ESCALATED`
  event one minute after creation, assigned to Sanjay Pawar, acknowledged in 2 to
  14 minutes (12% later), closed by the duty manager 10 minutes to 4 hours after
  that. There is no `PENDING_CONFIRMATION` and no rating.
- **Classification** (one row per complaint): `RULE` for safety; otherwise `LLM`
  85% (confidence 0.600 to 0.980), `FALLBACK` 10% (confidence null, because the
  keyword fallback gives no score; `needs_review` while not closed) and `MANUAL` 5% (a staff member corrects the
  category: a `CATEGORY_CORRECTED` event, confidence null, the classification
  row holds the corrected category).
- **Events**: `CREATED`, `CLASSIFIED`, `ASSIGNED`, `STATUS_CHANGED` (first
  response, and resolved), `COMMENT` (40%), `REOPENED`, `CATEGORY_CORRECTED`,
  `ESCALATED`, `CLOSED`; plus `DUPLICATE_LINKED` and `AFFECTED_TOO` for the
  clusters. Time order is non-decreasing; ties keep the order in which things
  logically happen.

### Database compatibility (K1 to K4, K6)

Rows satisfy the CHECKs of `20261104091653_complaints_outbox_audit_visitors`:
K1 safety implies CRITICAL; K2 a safety complaint's `close_kind` is null or
DUTY_MANAGER; K3 `closed_at` and `close_kind` exist exactly when CLOSED, and
PENDING_CONFIRMATION has `pending_confirmation_at`; K4 rating is 1 to 5, only on
CLOSED + CONFIRMED, and REOPENED needs `reopen_count >= 1`; K6 links have no
self link, one primary per duplicate and no chains. The tests (C5) write these
predicates again as pure functions and check every row.

### Duplicate clusters

Six incidents, each in one tower on one day, one category, different flats:

| Complaints | Tower | Category | Urgency |
|---|---|---|---|
| 12 | T07 | LIFT (lift outage) | HIGH |
| 9 | T14 | PLUMBING | NORMAL |
| 7 | T22 | ELECTRICAL | HIGH |
| 6 | T03 | HOUSEKEEPING | NORMAL |
| 5 | T25 | OTHER | NORMAL |
| 4 | T11 | PLUMBING | NORMAL |

The earliest complaint is the primary; the others are linked to it with
similarity 0.800 to 0.980 (no chains, each duplicate once). The incidents of 12,
9 and 6 also have 3 to 8 further flats of the same tower marked "affected too".

### Forced complaints

These use no random draws, so they are identical on every seed.

| Flat | Resident | Complaint |
|---|---|---|
| T12-0408 | Swati Joshi | PLUMBING "Water leak under the kitchen sink", NORMAL, raised 2026-10-26 17:00 IST, assigned to Kavita Rao at 17:30, status ASSIGNED, due 2026-10-27 17:00 IST, no first response. |
| T07-1203 | Neeraj Kulkarni | ELECTRICAL "Corridor light not working", NORMAL, raised 2026-10-24 11:00, first response 12:30, PENDING_CONFIRMATION since 2026-10-26 15:00 IST. |
| T15-0902 | Rohit Deshmukh | HOUSEKEEPING, NEW, raised 2026-10-27 10:00 IST, no assignee. |
| first T09 flat | its first member | Safety, "Smell of gas in the corridor", raised 2026-10-27 11:00 IST, ESCALATED at 11:01, assigned to Sanjay Pawar at 11:01, status ASSIGNED, no acknowledgement. |
| T21-1601 | Aamir Shaikh | No complaints. |

Swati Joshi has exactly two notifications, both unread: `COMPLAINT_ASSIGNED`
(2026-10-26 17:30) and `PAYMENT_REMINDER` (2026-10-27 09:00). T12-0408 also has
two visitors expected today: Ramesh Gupta at 11:00 and Anita Singh at 16:30 IST.

### Visitors, known payers, notifications

- **Visitors**: 150 other flats, 1 to 3 passes each, 0 to 13 days back at 08:00
  to 21:59. Earlier days: DEPARTED 85%, CANCELLED 15%. Today before 12:00:
  ARRIVED 40%, DEPARTED 45%, CANCELLED 15%. Today after 12:00: EXPECTED 90%,
  CANCELLED 10%. Only the two T12-0408 passes are EXPECTED in the past.
- **Known payers**: 720 flats (30% of 2,400), one `UPI_ID` each, built as
  `{first}.{lastInitial}@demo` in lower case from a member's name. `demo` is not
  a real bank handle. 60% `LEARNED` (no staff member), 40% `MANUAL` (added by
  Priya Nair). The seven sample flats have none.
- **Notifications**: 200 residents (not the four named sample residents), 1 to 3
  each, kinds `PAYMENT_REMINDER`, `PAYMENT_RECEIVED`, `COMPLAINT_UPDATE`,
  `NOTICE` in equal shares, half read a few minutes to a day and a half later.

### Assumptions (complaints)

- **A13.** The window is 2026-09-01 to `DEMO_NOW`, 56.5 days, so 3,450
  complaints is about 61 a day: 1,847 in September and 1,603 in October. "About
  1,800 a month" is met for September only, because October has 27 days.
- **A14.** Complaints are created between 06:00 and 23:00 IST (06:00 to 11:40 on
  the last day, 09:00 for safety complaints), spread evenly over the days.
- **A15.** LOW complaints always respond within their 3-day SLA, so the 14%
  breaches come from NORMAL and HIGH (16% of them). A LOW breach would take longer
  than the 3-day resolution cap that keeps old complaints closed.
- **A16.** A reopened complaint's first trip is always CONFIRMED, and its second
  trip is always CONFIRMED. A reopened-then-auto-closed path is not generated.
  At most one reopen per complaint; `reopen_count` is 1 or 0.
- **A17.** Resolution is at most 3 days after creation (about 2 days before a
  reopen), so every complaint older than 10 days is CLOSED, or REOPENED for the
  few reopened lately. About 8% not closed is therefore near the lower end of the
  8% to 12% range: only the last 10 days can be open.
- **A18.** Safety complaints are drawn as 30 random ones plus the forced gas
  complaint. Categories: FIRE and GAS under OTHER, LIFT_STUCK under LIFT, SHOCK
  under ELECTRICAL. Safety complaints do not get a `PENDING_CONFIRMATION` step,
  and none is reopened.
- **A19.** The gas complaint is raised from the first flat of tower T09 in code
  order and by its first member, so its flat can differ between seeds; its text,
  times, status and events do not.
- **A20.** The four sample flats (T12-0408, T07-1203, T15-0902, T21-1601) have
  only their forced complaints; no random complaint, cluster or affected-too row
  uses them.
- **A21.** The T07-1203 complaint's creation (2026-10-24 11:00), assignment (+10
  minutes), first response (+90 minutes) and comment (+3 hours) are my choice;
  the task fixes only its status and the 2026-10-26 15:00 pending time.
- **A22.** `DemoClassification` has no `latency_ms` or `output_hash`; the real
  classifier will fill those.
- **A23.** Cluster complaints also get the ordinary random lifecycle, so the
  complaints of one incident are not all closed at the same time. `DUPLICATE_LINKED`
  (on the duplicate, 2 minutes after it was created) and `AFFECTED_TOO` (on the
  primary) events exist because the database enum has them, though the task did
  not list them.
- **A24.** A pass is "EXPECTED" at 11:00 for Ramesh Gupta although `DEMO_NOW` is
  12:00, as the task says: he has not arrived yet.
- **A25.** Known payer ids are not unique across flats ("rahul.s@demo" can occur
  in two flats); the database only needs them unique per flat and identifier.
  Later matching must treat a shared id as unclear.
- **A26.** `allocateQuotas` (flats.ts) had a bug: it gave out only one leftover.
  It never mattered for areas, which have no leftover, and is fixed because the
  category quotas have one.

## How to seed, reset and deploy demo data

`src/server/seed` writes the dataset into Postgres. Every row gets a
deterministic id, `uuidFromKey(key)`: a version-5-style UUID from SHA-256 of the
fixed namespace `township-app/demo-seed/v1` and the key, so every run puts the
same key at the same id. Keys are unique per table, not across tables (a bill and
its BILL ledger entry share one key).

### Commands

```bash
npx prisma migrate deploy        # the schema must exist first
npm run db:seed -- --yes         # write the demo data into an EMPTY database
npm run db:reset-demo -- --yes   # drop and recreate the schema, then seed
```

`db:seed` runs the TypeScript through `tsx` (Node's own type stripping cannot
follow the domain code's extensionless imports). It loads `.env` at run time
with `process.loadEnvFile`, if the file exists; variables already in the shell
win.

### Guards

Both commands stop, and change nothing, unless all of these hold:

1. `DEMO_MODE` is exactly `true`.
2. `DATABASE_URL` is set. The command prints only the host and database name,
   never the user, password or URL.
3. `--yes` is given, so a person has seen that target and confirmed it.
4. For `db:seed`: the `flats` table is empty. Otherwise it says the database is
   not empty and points to `db:reset-demo`.

`db:reset-demo` checks 1 to 3, then runs `prisma migrate reset --force`. A plain
delete cannot work, because the append-only triggers forbid DELETE and TRUNCATE
on the ledger and on complaint events, so a reset recreates the schema. Prisma
itself refuses to run a reset when an AI agent starts it and needs the user's
written consent; a person running it in a terminal is not asked.

### What is written

One transaction, about 1,000 rows per multi-row `INSERT`, in foreign-key order:
users, user_permissions, flats, flat_members, society_settings, bills,
ledger_entries, complaint_categories, complaints, complaint_events,
classifications, complaint_links, complaint_affected, visitor_passes,
known_payers, notifications. The first database error rolls back everything and
names the table, the row key and the constraint.

Notes: complaint, event, classification and notification times are the
dataset's, not the time of the seed. Ledger entries and known payers have no
time in the dataset, so their `created_at` is the time of the seed. Columns the
dataset lacks (`latency_ms`, `output_hash`, `created_by_id`, `language`) are
NULL. A notification is `SENT` at its creation time, and its text is stored as
`{"text": "..."}`.

### Expected size and time (default seed, local Postgres 16)

| Table | Rows |
|---|---|
| users | 3,434 |
| user_permissions | 7 |
| flats | 2,400 |
| flat_members | 3,429 |
| society_settings | 11 |
| bills | 11,999 |
| ledger_entries | 25,579 |
| complaint_categories | 5 |
| complaints | 3,450 |
| complaint_events | 22,835 |
| classifications | 3,450 |
| complaint_links | 37 |
| complaint_affected | 16 |
| visitor_passes | 316 |
| known_payers | 720 |
| notifications | 402 |
| **total** | **78,090** |

About 3 seconds, and `pg_database_size` of about 29 MB with the schema and its
indexes. That is the figure to compare with the storage limit of the Neon free
tier (I did not check Neon's current limit; read it in the Neon console).

### Deploying demo data to Neon

1. Create the database and copy its **direct** (not pooled) connection string;
   migrations and the seed use one long transaction.
2. In a shell, not in a file you commit: `export DATABASE_URL='postgresql://...'`
   and `export DEMO_MODE=true`.
3. `npx prisma migrate deploy`, then `npm run db:seed -- --yes`. Check the
   printed host and database name are the Neon ones before confirming.
4. To start over: `npm run db:reset-demo -- --yes`. Never set `DEMO_MODE=true`
   against a database that holds real data.
