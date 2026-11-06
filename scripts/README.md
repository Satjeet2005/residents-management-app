# scripts

Developer and CI scripts (e.g. `scan-secrets.mjs`). No application logic.

- `smoke-app.mjs`: the resident pages and the pay flow over real HTTP against the built app: login, the Home numbers, Pay, a stale amount, a signed success and failure, bad signatures, the demo checkout's 404 and 307, the failure strip, and a staff upload of the sample bank statement (summary counts, a second upload skipped as repeats, a resident refused with 403; it reads `src/server/statements/sample-statement.ts` with Node's type stripping). `node scripts/smoke-app.mjs <BASE_URL> --as-of=<YYYY-MM-DD|real> --demo=true`. For the pay flow the script needs the server's `PAYMENT_WEBHOOK_SECRET` in its own environment; it signs events with it and never prints it.
- `smoke-auth.mjs`: checks login, `/api/me`, logout-all and the cookie over real HTTP against a running server. `npm run smoke:auth -- <BASE_URL> <demo phone>`. Needs the server in demo mode; prints lengths, never the code, token or cookie.
