# Authentication rules (`src/domain/auth`)

This module decides. It does no input or output: no database, no cookies, no clock, no random source. The
server layer (task T8b) hashes codes, stores rows, sets cookies and calls these functions with the time and
the random bytes. Login is a hand-built one-time code sent by SMS, with sessions kept in the database so they
can be ended at once (D16). In the demo the SMS is mocked (D3).

All times in this module are epoch milliseconds. Policies are written in seconds.

## Policy (`authPolicy`, `src/domain/auth/policy.ts`)

| Setting | Value | Defends against |
|---|---|---|
| OTP digits | 6 | Guessing: 1 in 1,000,000 per try. |
| OTP lifetime | 300 s | A code found later (a phone left on a table, an old message). |
| Attempts per code | 5 | Guessing one code. |
| Resend cooldown | 30 s | Someone pressing "send" repeatedly; SMS cost. |
| Codes per phone per hour | 5 | SMS flooding of one person; guessing by asking for new codes. |
| Codes per address per hour | 30 | One machine trying many phones. |
| Resident session | 14 days idle, 30 days overall | A lost phone stays open for less time; one login a month. |
| Staff session | 30 minutes idle, 12 hours overall | Staff can move money. One login per working day. |
| Touch throttle | 60 s | Writing `last_seen` on every request. |

D74 (resident) and D75 (staff) fix the session values. They follow the idea of NIST SP 800-63B, which asks
for re-authentication every 30 days at its lowest level (AAL1), and every 12 hours overall and after 30
minutes idle at its middle level (AAL2), and the OWASP session management guidance (an idle timeout and an
absolute timeout, both enforced on the server). These are guidance we followed, **not a certification claim**.
The sources were named by the human who decided; this task did not re-read them.

## Functions

### `phone.ts`

- `normalizePhone(input)` returns the 10-digit national number or `null`. It accepts spaces, hyphens and round
  brackets anywhere, and one prefix: `+91`, `91` or a single `0`. It rejects letters, any other character, a
  `+` that is not first, another country code, any other digit count, and a first national digit outside 5 to
  9. Digits of other scripts (Devanagari, Arabic-Indic, full-width) are rejected; only `0-9` count.
- `isDemoPhone(national)` is true when the number starts with 5. Our fictional numbers start with 5 and no real
  mobile number does (`src/domain/seed/people.ts`).
- Defends against: one person holding two accounts through formatting, and a flood of look-alike inputs.

### `otp.ts`: making a code

- `otpFromRandom(nextBytes, digits)`: digits from 4 to 9. It reads 32-bit big-endian words from `nextBytes`
  (16 bytes at a time) and accepts a word only when it is below `floor(2^32 / 10^digits) * 10^digits`, then
  takes `word % 10^digits`, padded with leading zeros. Without the rejection step the codes below
  `2^32 mod 10^digits` would be a little more likely. After 1,000 rejected words it throws a `RangeError`, so a
  broken byte source (all `0xFF`, for example) stops instead of looping.
- Defends against: a guessable skew in the codes. The size of the skew for 6 digits is small (1 in 4,294); the
  rule costs nothing and keeps the claim "every code is equally likely" true.

### `otp.ts`: asking for a code

`evaluateOtpRequest({ now, phoneRequestTimes, ipRequestTimes }, policy)` checks in this order:

1. `COOLDOWN`: the newest request from this phone is less than 30 s old. At exactly 30,000 ms it is allowed.
2. `PHONE_LIMIT`: this phone has 5 or more requests in the last 3,600,000 ms.
3. `IP_LIMIT`: this address has 30 or more in the same window.

`retryAfterSeconds` is rounded up and is at least 1. For a limit it is the time until enough old requests have
left the window to get below the limit; with exactly the limit, that is until the oldest leaves. A request
exactly one hour old is already out. Times after `now` are ignored.

### `otp.ts`: entering a code

`evaluateOtpAttempt({ now, expiresAt, attempts, consumedAt, codeMatches }, policy)` checks in this order:
`CONSUMED`, `EXPIRED` (at exactly `expiresAt`), `LOCKED` (5 attempts used, even when the code is right), then
`OK` or `WRONG`. The caller adds one to `attempts` after a `WRONG`. `WRONG` reports
`attemptsLeft = max - (attempts + 1)`.

The order matters. A used code must never work twice (replay). An attacker's last guess must not win once the
code is locked, so the attempt limit is checked before the digits are compared.

### `otp.ts`: what the client is told

`authMessageKey(outcome)` gives one of four keys, for later translation:

| Key | Used for |
|---|---|
| `OTP_SENT_GENERIC` | A code was sent. The same for a registered and an unregistered phone. |
| `OTP_NOT_ACCEPTED` | Wrong, expired or already used. The client cannot tell which. |
| `OTP_LOCKED` | Too many attempts on this code. |
| `TOO_MANY_REQUESTS` | Cooldown, phone limit or address limit. The client cannot tell which. |

### `session.ts`

- `newSessionExpiry(role, now, policy)` is `now` plus the role's absolute limit.
- `evaluateSession(record, now, policy)` checks in this order: `USER_INACTIVE`, `REVOKED`, `EXPIRED_ABSOLUTE`
  (at exactly `absoluteExpiresAt`), `EXPIRED_IDLE` (time since `lastSeenAt` has reached the idle limit), else
  valid. `shouldTouch` is true once 60 s have passed since `lastSeenAt`.
- Defends against: a stolen or forgotten device (idle and overall limits, and `REVOKED`), a person who has
  left (`USER_INACTIVE` is checked first, so a deactivated person is out at once even with a live session),
  and a session that never ends.

### `permissions.ts`

`PERMISSIONS` are `payments:match`, `payments:approve`, `reports:view`, `complaints:manage` and
`complaints:duty_manager`. `can(user, needed)` is the one rule (D1): a resident is always false; an inactive
user is false; staff are true only when the permission is listed. An unknown string never matches.

## Threat notes

| Threat | What in this module defends against it | What the server layer must also do (T8b) |
|---|---|---|
| User enumeration (learning which phones have accounts) | One generic "sent" key; one "not accepted" key; the limits and the cooldown give the same answers whether or not the phone is registered. | Record every request, for unregistered phones too, and send nothing for them. Take the same time either way. |
| Brute force on a code | 5 attempts per code, lock even for the right code, 5 codes per phone per hour. At most 25 guesses an hour per phone, about 1 chance in 40,000. | Only the newest code for a phone may be valid. Count attempts in the database, not in the browser. |
| Code replay | `CONSUMED` is checked first; `EXPIRED` at exactly the expiry time; a 5-minute life. | Mark the code used in the same transaction that creates the session. |
| Session fixation | Not decided here. | Make a new session id at login and never accept one the client chose. |
| SMS abuse (cost, harassment) | Cooldown, 5 per phone and 30 per address an hour. | Store the request times so they survive a restart; get the address from a trusted source. |
| Shared phones | One phone, one national number. Nothing here lets two accounts share a number. | A unique index on the phone. Say so in the UI when a family shares a phone. |
| Stolen device | Idle and overall limits (30 min and 12 h for staff; 14 d and 30 d for residents), `REVOKED`, `USER_INACTIVE`. | Offer "sign out everywhere"; end sessions when a role changes. |
| Code guessing by chance | 6 digits, unbiased (rejection sampling). | Take the bytes from the operating system's secure random source, never a seeded one. |

## Not covered here

Hashing the code, comparing it in constant time, creating the session id, cookies (`HttpOnly`, `Secure`,
`SameSite`), CSRF protection, where the request times and attempts are stored, the SMS provider, and the
screens. These belong to T8b. A fresh OTP before approving a large manual payment is a **documented next
step, not built** (R23): the 25,000 rupee second-approver rule stays as the only control on large payments.

## Assumptions

- **AU-A1** Only Indian numbers are accepted: `+91`, `91`, `0` or no prefix. `00` is not accepted.
- **AU-A2** A 10-digit input is always a national number, even if it starts with 91.
- **AU-A3** The rejection limit is 1,000: the call throws when the 1,000th word is rejected. The batch is 16
  bytes (four words).
- **AU-A4** OTP functions take the `otp` part of the policy (`OtpPolicy`); session functions take
  `SessionPolicy` (`session` and `touchThrottleSeconds`). So callers pass `authPolicy.otp` to the first and
  `authPolicy` itself to the second.
- **AU-A5** When a phone has more requests in the window than the limit (a lowered limit, for example), the
  wait is until enough have left to get below it. At exactly the limit this is the oldest request, as asked.
- **AU-A6** `attemptsLeft` is 0 for `CONSUMED`, `EXPIRED` and `LOCKED`, and `max - attempts` for `OK`.
- **AU-A7** `authMessageKey` takes `SENT`, the three refusals and the four non-OK outcomes. An accepted code
  needs no message, so `OK` is not an input.
- **AU-A8** A `lastSeenAt` or request time after `now` (clock skew) counts as "just now" for sessions and is
  ignored for request limits.
- **AU-A9** `createdAt` is part of the stored session but the end is the stored `absoluteExpiresAt`. Changing
  the policy later does not shorten sessions that already exist.
- **AU-A10** The caller records requests for unregistered phones too (see the threat table).
- **AU-A11** The uniformity test is seeded (seeds 1, 2 and 3) and allows 5 standard deviations per count.
  A 3% bound was only 2.45 standard deviations and a fair generator would fail it on about 58% of seeds. The
  test sees a gross skew, not the 1-in-4,294 bias; the rejection tests see that.
- **AU-A12** The policy numbers are the human's confirmed defaults (R21, R22).
