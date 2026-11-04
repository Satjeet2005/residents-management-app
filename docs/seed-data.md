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
11,999 bills and 25,579 ledger entries, and takes about 150 ms to build.

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
