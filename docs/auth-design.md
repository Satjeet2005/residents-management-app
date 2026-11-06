# Authentication rules (`src/domain/auth`)

`src/domain/auth` decides. It does no input or output: no database, no cookies, no clock, no random source.
The server layer (`src/server/auth`, task T8b, described from "Server layer" below) hashes codes, stores rows,
sets cookies and calls these functions with the time and the random bytes. Login is a hand-built one-time code sent by SMS, with sessions kept in the database so they
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

This table was written with the domain rules. Its last column lists what T8b had to do; the "Server threat table" below says what was built and what is still open.

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

## Server layer (T8b)

Files in `src/server/auth`: `crypto.ts` (hashes, tokens), `client-ip.ts`, `return-url.ts`, `otp-service.ts`
(request and verify), `session-service.ts`, `cookie.ts`, `audit.ts`, `schemas.ts` (zod), `handlers.ts` (the four
routes' logic). The route files in `src/app/api/auth/**` are one-line wrappers. The database is the Prisma
client (`src/server/db.ts`); services take it as an argument, and take the time as a number, so tests control both.

### Flow, in words

1. **Ask for a code** (`POST /api/auth/otp/request`, `{ phone }`). The body is checked with zod. The phone is
   normalised; a bad format is a 400 `INVALID_PHONE`, which says nothing about accounts. Otherwise the last
   hour of requests for this phone and for this address (its HMAC) are read and `evaluateOtpRequest` decides.
   If blocked: a 429 with `Retry-After`, and an `OTP_BLOCKED` audit row. If allowed: in one transaction every
   earlier unused code of the phone is marked used, a new row is stored (HMAC of the code, expiry, address
   HMAC), and an `OTP_REQUESTED` audit row is written. This is done for registered, inactive and unknown
   phones alike. Only after that, and only if the phone has an active user, the sender is called. The answer is
   the same 200 `{ message: "OTP_SENT_GENERIC", retryAfterSeconds: 30 }` in every case.
2. **Enter the code** (`POST /api/auth/otp/verify`, `{ phone, code, returnTo? }`). The newest code row of the
   phone is read (older codes were retired at the last request). The code is hashed and compared in constant
   time, and `evaluateOtpAttempt` decides. A wrong code adds one attempt with one atomic `UPDATE ... WHERE
   attempts < 5 RETURNING`. A right code is used up with `UPDATE ... SET consumed_at WHERE consumed_at IS NULL
   AND attempts < 5 AND expires_at > now RETURNING`; zero rows means a replay or a lost race. If the phone has no
   active user the code is still used up and the answer is "not accepted". On success a session is created, a
   `LOGIN_SUCCEEDED` audit row is written, the cookie is set, and the body is `{ role, redirectTo }`.
3. **Use the app.** A later request (T8c) calls `resolveSession(token)`: one query for session, user and
   permissions; the domain rules decide; `last_seen_at` is written at most once a minute.
4. **Log out** (`POST /api/auth/logout`, `/logout-all`). The session in the cookie is ended (all of the
   person's sessions for logout-all), an audit row is written, the cookie is cleared, and the answer is 204.

### Responses

| Case | Status | Body |
|---|---|---|
| Code request, any valid phone | 200 | `{ message: "OTP_SENT_GENERIC", retryAfterSeconds }` (plus `demoCode` in demo mode for a demo phone) |
| Bad body, wrong types, too large, wrong Origin | 400 | `{ error: "INVALID_REQUEST" }` |
| Bad phone on a request | 400 | `{ error: "INVALID_PHONE" }` |
| Code not accepted (wrong, old, used, expired, unknown phone, no active user) | 400 | `{ error: "OTP_NOT_ACCEPTED" }` |
| Code locked | 400 | `{ error: "OTP_LOCKED" }` |
| Cooldown, phone limit or address limit | 429 | `{ error: "TOO_MANY_REQUESTS", retryAfterSeconds }` and a `Retry-After` header |
| Login accepted | 200 | `{ role, redirectTo }` and `Set-Cookie` |
| Logout | 204 | none, and the cookie cleared (also when there was no session) |
| Logout-all with no valid session | 401 | `{ error: "UNAUTHENTICATED" }` |

No route answers 401 or 404 in a way that tells a registered phone from an unregistered one. Every response
carries `Cache-Control: no-store`.

### Storage

- The code is stored as `HMAC-SHA256(OTP_PEPPER, phone + ":" + code)` (D78). Without the pepper a stolen table
  cannot be brute-forced offline, even though there are only a million codes.
- The address is stored as `HMAC-SHA256(OTP_PEPPER, "ip:" + address)`, never as text.
- The session token is 32 random bytes, base64url. Only `SHA-256(token)` is stored (D79). The token is
  long and random, so a plain hash is enough and no pepper is needed.
- The pepper fails closed: in production a missing, short (under 32 characters) or placeholder value throws on
  first use, before anything is written. Codes, tokens and the pepper are never logged.
- The demo code is returned in the response only, for a demo phone while `DEMO_MODE` is exactly `"true"`, and
  is never stored or logged (D77).
- Only the newest code of a phone is valid (D80).

### Cookie

`__Host-session` in production (Secure, `Path=/`, no `Domain`), `session` elsewhere (no Secure, because
`http://localhost` is not https). Always `HttpOnly` and `SameSite=Lax`. `Max-Age` is the time left to the absolute
end. Clearing uses the same name and attributes with `Max-Age=0`.

### Client address

Vercel's documentation (`vercel.com/docs/headers/request-headers`, page last updated 2025-12-13) says
`x-forwarded-for` is the client's public IP, that Vercel overwrites it and does not forward external values to
prevent spoofing, and that `x-vercel-forwarded-for` and `x-real-ip` carry the same value, with
`x-vercel-forwarded-for` not overwritten by a proxy in front of Vercel. `clientIp(headers)` therefore trusts
those headers (in that order) only when `VERCEL=1`, and returns `"unknown"` everywhere else, where a client could
forge them. Local development shares one bucket, which is safe: the limits are stricter, not looser.

### Server threat table

| Threat | Defence | Not covered |
|---|---|---|
| User enumeration | The same 200 answer for registered, inactive and unknown phones; a row is stored for all, so limits and cooldown behave the same; the sender is called only for active users; a format error reveals nothing; all refusals are generic keys; a sender failure is hidden. | Timing: a real SMS call takes time only for active users. The mock sender does nothing, so there is no difference today. A real provider must be called from the outbox, not in the request. |
| Brute force on a code | 5 attempts per code, atomic in SQL; locked even for the right code; 5 codes per phone an hour, only the newest valid: at most 25 guesses an hour per phone (1 in 40,000). A CHECK keeps attempts between 0 and 100. | A distributed guess across many phones is not a guess at one account. |
| Replay | The code is used up by a conditional UPDATE; expiry in 5 minutes; an older code is retired by the next request. | A code read from the phone's screen before the user types it (interception). |
| Code interception (SMS) | Short life, single use, locked after 5 wrong tries. | SIM swap, SMS forwarding and screen reading. SMS is a single-factor, weak channel; staff sessions are short for that reason (D75). |
| Session theft | Only the token hash is stored; HttpOnly, Secure and `__Host-` in production; idle and absolute limits; `logout-all`; the user's `active` flag is read on every request. | Malware on the device; a stolen unlocked staff phone inside its 12-hour window (see R23). |
| Session fixation | A new random token is made at every login; the server never accepts a token chosen by the client. | None known. |
| CSRF on logout and the other routes | `SameSite=Lax` (the cookie is not sent on a cross-site POST) and an Origin check: a POST whose Origin is another site is refused. | A same-site attacker (a hostile subdomain): the `__Host-` prefix stops it planting the cookie. |
| Open redirect | `safeReturnPath` accepts a same-site path only, and decodes it twice to catch `%2f%2f`. | A `returnTo` to a staff page by a resident: access is decided by T8c, not here. |
| Timing | The code is compared with `timingSafeEqual`; a missing code row does the same hashing; only HMAC digests are compared. | Differences in database time between an existing and a missing row. |
| SMS abuse | Cooldown, 5 per phone and 30 per address an hour; the address is read only from headers Vercel does not let a client forge. | A botnet with many addresses; an SMS provider budget cap. |
| Oversized or malformed input | zod on every body; a body over 4,096 characters is refused; unknown fields are dropped. | |
| Audit growth | Only counted events are written (see SA8). | Audit rows are never deleted (the table is append-only). |

## Not covered

The `withPermission` wrapper and a test that every route is guarded (T8c); a global rate limit on all routes; a
fresh OTP before approving a large manual payment (documented next step, **not built**, R23); the SMS provider
and the screens; refresh of the pepper (changing it invalidates all codes in flight, which live 5 minutes);
moving the rate-limit counters to a fast store (they are read from `otp_codes` with two indexes, which is enough
for one society).

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
- **SA1** The services take the Prisma client (`Db`) and a `now` in epoch milliseconds; `created_at` is written
  from `now` so tests control the clock. The database default is not used for these rows.
- **SA2** `retryAfterSeconds` on a successful request is the resend cooldown (30).
- **SA3** The demo code is also returned for an unregistered demo phone, so the response has the same shape for
  both. It is useless without an account.
- **SA4** A sender that throws is logged as the fixed text "otp sender failed" and the answer stays 200, so the
  answer does not show whether the phone has an account.
- **SA5** A refused request (blocked) is not stored as a code row, so a blocked client cannot extend its own wait.
- **SA6** `returnTo` is checked as a path only. A path with a bad percent sequence, such as `/50%25`, which
  decodes to `/50%`, is also sent home. This is conservative.
- **SA7** `logout` always answers 204 and clears the cookie; `logout-all` answers 401 without a session.
- **SA8** `LOGIN_FAILED` is written for each counted wrong attempt and when the code becomes locked, and for a
  right code on a phone with no active user. It is not written for repeated tries on an already locked, used or
  expired code, or for a phone that never asked for a code, because an attacker could use those to fill the
  audit table.
- **SA9** `sessions` has no `created_at`, so `evaluateSession` is given a start derived from the end and the
  role's absolute limit. It is not used in the decision.
- **SA10** A request with an `Origin` header for another host is refused; one with no `Origin` is allowed (not a
  browser form post). The host is compared with the `Host` header.
- **SA11** In production the pepper must be at least 32 characters and must not start with `replace-with`
  (the `.env.example` placeholder). Elsewhere any non-empty value works.
- **SA12** `codeHash` and `ipHash` use the same key and different message forms (`phone:code`, `ip:address`). A
  phone is 10 digits, so the two forms cannot collide.
