# Late-fee policy

How the late fee on an unpaid maintenance bill is worked out. The code is
`computeLateFee` in `src/domain/billing/late-fee.ts`; these are decisions D26,
D35 and D46. The fee is computed on demand and never stored.

All money is integer paise held as a `bigint`. Rupee figures below are for
reading only.

## The rules

| Rule | Statement |
|---|---|
| R-a | Overdue days are the calendar days `dueOn + 1` to `asOf`, both inclusive. If `asOf` is on or before `dueOn` the fee is 0. |
| R-b | The balance for an overdue day `d` is the bill minus the payments dated **strictly before** `d` (a payment reduces the balance from the day after its date), never below 0. Payments dated after `asOf` are ignored. A payment of 0 or less is an error. |
| R-c | Day `d` is **skipped** if its start instant, 00:00 India Standard Time, lies in a hold: the half-open interval `[startedAt, endedAt)`. An open hold has no end. A hold is a period in which a payment attempt on the bill was unresolved. Skipped days accrue nothing. |
| R-d | The fee is one exact fraction, rounded once. Sum `balance x annualRateBps` over the charged days, divide by `10000 x daysInYear`, and round the total to the nearest whole rupee, half up. The year is always 365 days, also in a leap year. |
| R-e | An `annualRateBps` above `capBps`, or any invalid input (a bad date, a non-positive payment or bill), throws `RangeError`. |

Defaults: `annualRateBps` 1200 (12% a year), `capBps` 2100 (21%), `daysInYear` 365.

## The formula

```
numerator   = sum over charged days d of  balance(d) x annualRateBps
exact fee   = numerator / (10000 x daysInYear)            in paise
fee         = round_half_up(numerator / (10000 x daysInYear x 100)) x 100
amount due  = outstanding + fee
outstanding = max(0, bill - payments dated on or before asOf)
```

Rounding happens once, on the total, so a ₹2.09 daily fee is not rounded to ₹2
forty-seven times. With `daysInYear` 365 the denominator is 3,650,000 for a
12% rate.

## Worked examples

### F1: T12-0408, no payments

Bill ₹6,370 (637,000 paise), due 2026-09-10, as of 2026-10-27.

1. Overdue days: 11 to 30 September is 20 days, 1 to 27 October is 27 days. 47 days.
2. No payments, so the balance is 637,000 paise on every day. One segment of 47 days.
3. numerator = 637,000 x 1,200 x 47 = 35,926,800,000.
4. exact fee = 35,926,800,000 / 3,650,000 = 9,842.96 paise = ₹98.43.
5. Round once to whole rupees: ₹98.43 becomes ₹98, so the fee is 9,800 paise.
6. Outstanding ₹6,370; amount due ₹6,370 + ₹98 = **₹6,468**.

### F2: T21-1601, a part payment

Bill ₹10,660 (1,066,000 paise), due 2026-10-09, ₹5,000 (500,000 paise) paid on
2026-10-12, as of 2026-10-27.

1. Overdue days: 10 to 27 October, 18 days.
2. The payment dated 12 October reduces the balance from 13 October. So 10, 11
   and 12 October (3 days) use 1,066,000 paise, and 13 to 27 October (15 days)
   use 566,000 paise.
3. numerator = 1,200 x (3 x 1,066,000 + 15 x 566,000) = 1,200 x 11,688,000 = 14,025,600,000.
4. exact fee = 14,025,600,000 / 3,650,000 = 3,842.63 paise = ₹38.43.
5. Round once: ₹38, so the fee is 3,800 paise.
6. Outstanding ₹10,660 - ₹5,000 = ₹5,660; amount due ₹5,660 + ₹38 = **₹5,698**.

### F5: a skipped day

T12-0408 as of 2026-10-30, with one hold from 2026-10-27 18:00 IST to
2026-10-28 21:00 IST.

1. Overdue days: 20 in September plus 30 in October is 50.
2. Which day starts inside `[27 Oct 18:00, 28 Oct 21:00)`? 28 October starts at
   00:00 on the 28th, which is inside, so it is skipped. 27 October started at
   00:00 on the 27th, before the hold began, so it is charged. 29 October
   starts after the hold ended, so it is charged. Skipped: 1; charged: 49.
3. numerator = 637,000 x 1,200 x 49 = 37,455,600,000.
4. exact fee = 37,455,600,000 / 3,650,000 = 10,261.81 paise = ₹102.62, rounded to ₹103.
5. Segments: 11 Sep to 27 Oct (47 days) and 29 to 30 Oct (2 days). The skipped
   day is in neither.
6. Amount due ₹6,370 + ₹103 = **₹6,473**.

### F6: a released hold

T12-0408 as of 2026-10-31, with a hold from 2026-10-27 18:00 IST to
2026-10-29 11:00 IST.

1. Overdue days: 20 in September plus 31 in October is 51.
2. 28 October starts at 00:00, inside the hold. 29 October starts at 00:00,
   which is also before 11:00, so it is inside too. 30 October starts after the
   hold ended. Skipped: 2; charged: 49.
3. The charged days all have a balance of 637,000 paise, so the numerator and the
   fee are the same as F5: ₹102.62 rounded to **₹103**.

The same bill with the hold starting 2026-10-27 18:00 IST and `asOf` 2026-10-27
skips nothing: 27 October began at 00:00, before the hold.

## Principal paid, fee owed

Decisions D107 and D110. The code is `billPosition` (`src/domain/billing/position.ts`), `planPosting`
(`src/domain/billing/posting.ts`) and `positionsForFlat` (`src/domain/billing/dues.ts`).

A bill is in one of three positions on a date:

| Position | When | Amount due |
|---|---|---|
| `PRINCIPAL_OPEN` | payments up to the date are below the bill | outstanding principal + the computed fee (as above) |
| `FEE_ONLY` | payments reach the bill, but the posted late fee is not all paid | what remains of the posted fee |
| `SETTLED` | payments reach the bill and the fee is paid (or there was none) | 0 |

The fee is **posted when the principal reaches zero** (D110): a payment that brings the payments on a bill to at least the bill
also posts a `LATE_FEE` charge for the fee accrued through that payment's date, dated that day. While the principal is open no
fee is posted, so a part payment of the principal posts a `PAYMENT` alone and the fee keeps accruing as before. After the
principal is paid the fee stops growing (the balance is 0), and it **stays owing** (D107): nothing waives it silently. A waiver
would be a separate, approved workflow (a next step, not built). Payments above the bill ("excess") count toward the fee.

`planPosting(position, credit, paymentDate)` for a bill with principal O and fee f on the payment date:

| Credit | Entries | Position after |
|---|---|---|
| `O + f` | `LATE_FEE f` (if above 0), `PAYMENT credit` | SETTLED |
| `O` | `LATE_FEE f`, `PAYMENT credit` | FEE_ONLY, f owing |
| between `O` and `O + f` | `LATE_FEE f`, `PAYMENT credit` | FEE_ONLY, `O + f - credit` owing |
| below `O` | `PAYMENT credit` | PRINCIPAL_OPEN, the fee keeps accruing |
| above `O + f` | refused: EXCESS | unchanged |
| a bill that is FEE_ONLY, up to the remainder | `PAYMENT credit` (never a second `LATE_FEE`) | FEE_ONLY or SETTLED |
| a SETTLED bill | refused: NO_DUES | unchanged |

### F7: T21-1601 pays ₹5,660 (the principal) on 27 October

Before: ₹5,660 principal and ₹38 fee, ₹5,698 due (F2). The credit equals the principal, so the entries are `PAYMENT ₹5,660`
and `LATE_FEE ₹38`, both dated 2026-10-27. The ledger is BILL +₹10,660, PAYMENT -₹5,000, PAYMENT -₹5,660, LATE_FEE +₹38: a
balance of ₹38. The Home shows the tag "Late fee due", "Amount due, as of 27 Oct" and ₹38, with a Pay ₹38 button; the breakdown
lists "Bill issued, October, paid in full", the two payments and "Late fee, accrued until 27 Oct" ₹38, with the working of F2.
On 31 December the amount is still ₹38: the fee does not grow after the principal is paid.

A later payment of ₹38 posts one `PAYMENT` (no second `LATE_FEE`) and the position is SETTLED. Paid in two parts, ₹18 and then
₹20, the first leaves ₹20 due and the second settles it. Paying ₹5,698 in one go posts `LATE_FEE ₹38` and `PAYMENT ₹5,698`:
SETTLED at once, the same shape the seed gives a bill paid late.

### Anomalies

The position says so, and never hides it:

- `FEE_POSTED_ON_OPEN_BILL`: a `LATE_FEE` on a bill whose principal is open (for example after the principal payment was
  reversed). The posted fee is not trusted; the computed fee is used.
- `FEE_NOT_POSTED`: the principal is paid, no fee was posted, but the fee at the settling date is above 0. The computed fee is
  owed, so money does not vanish.

A seeded database has neither (a test reads every flat).

## Assumptions

These are choices the rules above leave open. They are written in the code and
tested.

- **A1.** A hold's instants are epoch milliseconds. "Day `d` is skipped" means
  its 00:00 IST instant is inside the hold, so a hold that begins at 18:00 does
  not skip that same day.
- **A2.** The hold interval is half-open: a hold that starts exactly at a day's
  start skips that day; one that ends exactly at a day's start does not.
- **A3.** A hold that ends before it starts is an error. A hold whose start
  equals its end is empty and skips nothing.
- **A4.** A skipped day ends a segment. Two runs with the same balance on either
  side of a skipped day are two segments, so segment day counts add up to the
  charged days.
- **A5.** Days that are charged but have a balance of 0 (the bill is fully paid
  but still overdue by the calendar) are kept as segments with a balance of 0.
- **A6.** A payment dated on `asOf` counts toward the outstanding amount but not
  toward the fee base, because it reduces the balance from the next day.
- **A7.** A bill amount of 0 or less is an error (the database also requires a
  positive bill).
- **A8.** The policy validator enforces `annualRateBps <= capBps`, whole numbers,
  and `daysInYear > 0`. It does not enforce the 21% ceiling; that is a business
  setting for the caller.
- **A9.** Calendar dates are `YYYY-MM-DD` with years 1000 to 9999 (`Date.UTC`
  treats years 0 to 99 as 1900 to 1999). Each overdue day is visited once, so a
  very large span is a long loop.
- **A10.** Rounding a negative amount to whole rupees goes half away from zero,
  so it mirrors the positive case. The late fee itself is never negative.
- **A11.** The settling date of a bill is the first date on which the payments dated up to and including it reach the bill. The
  fee posted and the fee shown are the fee accrued through that date.
- **A12.** An ADJUSTMENT entry on a bill moves the fee side only, never the principal: a CHARGE adds to the fee owed, a PAYMENT
  takes from it, never below zero. It also applies to the fee of a bill whose principal is still open. The app does not create
  adjustments yet.
- **A13.** Reversing a principal payment does not reverse the late fee that was posted with it. The bill reopens and the posted
  fee is flagged `FEE_POSTED_ON_OPEN_BILL`; a person must correct it with a new entry.
- **A14.** The position takes holds as input (R-c) but the Home, the lock and the import still pass none (P10).
